/**
 * Chat completions handler - refactored for multi-provider support
 */

import * as http from 'http';
import { getProviderRegistry } from '../providers/registry';
import { getLoggingService } from '../logging';
import { getCacheService } from '../cache';
import {
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
} from '../types';
import { CompletionOptions, StreamChunk } from '../providers/types';

/**
 * Parse the request body as JSON
 */
async function parseBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body) as T);
            } catch (err) {
                reject(new Error('Invalid JSON in request body'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Generate a unique completion ID
 */
function generateCompletionId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert request to CompletionOptions
 */
function extractOptions(body: ChatCompletionRequest): CompletionOptions {
    return {
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        topP: body.top_p,
        frequencyPenalty: body.frequency_penalty,
        presencePenalty: body.presence_penalty,
        stop: body.stop
    };
}

/**
 * Handle streaming response
 */
async function handleStreamingResponse(
    res: http.ServerResponse,
    chunks: AsyncIterable<StreamChunk>,
    modelId: string,
    completionId: string,
    created: number,
    onComplete: (response: string) => void
): Promise<void> {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send initial chunk with role
    const initialChunk: ChatCompletionChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [{
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null
        }]
    };
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

    let fullContent = '';

    try {
        for await (const chunk of chunks) {
            if (chunk.content) {
                fullContent += chunk.content;
                
                const dataChunk: ChatCompletionChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model: modelId,
                    choices: [{
                        index: 0,
                        delta: { content: chunk.content },
                        finish_reason: null
                    }]
                };
                res.write(`data: ${JSON.stringify(dataChunk)}\n\n`);
            }

            if (chunk.finishReason) {
                const finalChunk: ChatCompletionChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model: modelId,
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: chunk.finishReason
                    }]
                };
                res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        onComplete(fullContent);
    } catch (err) {
        const errorChunk = {
            error: {
                message: err instanceof Error ? err.message : 'Unknown error during streaming',
                type: 'server_error'
            }
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        throw err;
    }

    res.end();
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(
    res: http.ServerResponse,
    chunks: AsyncIterable<StreamChunk>,
    modelId: string,
    completionId: string,
    created: number
): Promise<string> {
    let content = '';
    
    for await (const chunk of chunks) {
        content += chunk.content;
    }

    const completion: ChatCompletionResponse = {
        id: completionId,
        object: 'chat.completion',
        created,
        model: modelId,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content
            },
            finish_reason: 'stop'
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(completion, null, 2));

    return content;
}

/**
 * Handle cached response
 */
function handleCachedResponse(
    res: http.ServerResponse,
    cachedContent: string,
    modelId: string,
    completionId: string,
    created: number,
    streaming: boolean
): void {
    if (streaming) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Send role chunk
        res.write(`data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
        })}\n\n`);

        // Send content chunk
        res.write(`data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta: { content: cachedContent }, finish_reason: null }]
        })}\n\n`);

        // Send finish chunk
        res.write(`data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}\n\n`);

        res.write('data: [DONE]\n\n');
        res.end();
    } else {
        const completion: ChatCompletionResponse = {
            id: completionId,
            object: 'chat.completion',
            created,
            model: modelId,
            choices: [{
                index: 0,
                message: { role: 'assistant', content: cachedContent },
                finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(completion, null, 2));
    }
}

/**
 * Handle POST /v1/chat/completions
 */
export async function handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    let body: ChatCompletionRequest;

    try {
        body = await parseBody<ChatCompletionRequest>(req);
    } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Invalid JSON in request body',
                type: 'invalid_request_error',
                param: null,
                code: 'invalid_json'
            }
        }));
        return;
    }

    // Validate required fields
    if (!body.model) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Missing required field: model',
                type: 'invalid_request_error',
                param: 'model',
                code: 'missing_required_field'
            }
        }));
        return;
    }

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Missing required field: messages',
                type: 'invalid_request_error',
                param: 'messages',
                code: 'missing_required_field'
            }
        }));
        return;
    }

    // Lookup model in provider registry
    const registry = getProviderRegistry();
    const lookup = registry.lookupModel(body.model);

    if (!lookup) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: `Model '${body.model}' not found. Use GET /v1/models to see available models.`,
                type: 'invalid_request_error',
                param: 'model',
                code: 'model_not_found'
            }
        }));
        return;
    }

    const { provider, model, fullId } = lookup;
    const options = extractOptions(body);
    const streaming = body.stream ?? false;

    // Check cache first
    const cacheService = getCacheService();
    const cachedResponse = cacheService.get(provider.id, model.id, body.messages, options);

    const completionId = generateCompletionId();
    const created = Math.floor(Date.now() / 1000);

    // Start logging
    const loggingService = getLoggingService();
    const log = loggingService.startLog(provider.id, model.id, body.messages, options, streaming);

    if (cachedResponse) {
        handleCachedResponse(res, cachedResponse, fullId, completionId, created, streaming);
        log.complete(cachedResponse, undefined, true);
        return;
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    try {
        const chunks = provider.sendChatCompletion(
            model.id,
            body.messages,
            options,
            abortController.signal
        );

        if (streaming) {
            await handleStreamingResponse(
                res,
                chunks,
                fullId,
                completionId,
                created,
                (response) => {
                    log.complete(response);
                    cacheService.set(provider.id, model.id, body.messages, options, response);
                }
            );
        } else {
            const response = await handleNonStreamingResponse(
                res,
                chunks,
                fullId,
                completionId,
                created
            );
            log.complete(response);
            cacheService.set(provider.id, model.id, body.messages, options, response);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        log.complete(undefined, errorMessage);

        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: errorMessage,
                    type: 'server_error'
                }
            }));
        }
    }
}
