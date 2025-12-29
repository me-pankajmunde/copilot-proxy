/**
 * Chat completions handler - refactored for multi-provider support with tool calling
 */

import * as http from 'http';
import { getProviderRegistry } from '../providers/registry';
import { getLoggingService } from '../logging';
import { getCacheService } from '../cache';
import { getToolRegistry } from '../tools/registry';
import { Tool, ToolCall } from '../tools/types';
import {
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    OpenAIMessage,
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
        stop: body.stop,
        tools: body.tools,
        toolChoice: body.tool_choice
    };
}

/**
 * Merge tools from request with registry tools
 */
function getMergedTools(requestTools?: Tool[]): Tool[] {
    const registry = getToolRegistry();
    const registryTools = registry.getAvailableTools();
    
    if (!requestTools || requestTools.length === 0) {
        return registryTools;
    }
    
    // Merge: request tools take precedence
    const toolMap = new Map<string, Tool>();
    for (const tool of registryTools) {
        toolMap.set(tool.function.name, tool);
    }
    for (const tool of requestTools) {
        toolMap.set(tool.function.name, tool);
    }
    
    return Array.from(toolMap.values());
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
    const streaming = body.stream ?? false;
    
    // Merge tools from request with registry tools
    const tools = getMergedTools(body.tools);
    const options = extractOptions(body);
    if (tools.length > 0) {
        options.tools = tools;
    }

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
        // For non-streaming with tools, we may need to execute a tool loop
        if (!streaming && tools.length > 0) {
            const result = await executeWithToolLoop(
                provider,
                model.id,
                body.messages,
                options,
                abortController.signal,
                fullId,
                completionId,
                created
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result, null, 2));
            
            log.complete(result.choices[0]?.message?.content || '');
            if (result.choices[0]?.message?.content) {
                cacheService.set(provider.id, model.id, body.messages, options, result.choices[0].message.content);
            }
        } else {
            // Standard streaming/non-streaming without tool loop
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

/**
 * Execute completion with tool calling loop
 * Runs until the model produces a final response without tool calls (or max iterations)
 */
async function executeWithToolLoop(
    provider: any,
    modelId: string,
    messages: OpenAIMessage[],
    options: CompletionOptions,
    signal: AbortSignal,
    fullId: string,
    completionId: string,
    created: number,
    maxIterations: number = 5
): Promise<ChatCompletionResponse> {
    const toolRegistry = getToolRegistry();
    const config = toolRegistry.getConfig();
    const conversationMessages = [...messages];
    
    let iterations = 0;
    const maxToolCalls = config.maxToolCalls || 5;

    while (iterations < maxIterations) {
        iterations++;

        // Get completion from model
        const chunks = provider.sendChatCompletion(
            modelId,
            conversationMessages,
            options,
            signal
        );

        let content = '';
        let toolCalls: ToolCall[] = [];
        let finishReason: string | null = null;

        // Collect full response
        for await (const chunk of chunks) {
            if (chunk.content) {
                content += chunk.content;
            }
            if (chunk.toolCalls) {
                toolCalls = chunk.toolCalls;
            }
            if (chunk.finishReason) {
                finishReason = chunk.finishReason;
            }
        }

        // If no tool calls or finish reason is not tool_calls, return final response
        if (toolCalls.length === 0 || finishReason !== 'tool_calls') {
            return {
                id: completionId,
                object: 'chat.completion',
                created,
                model: fullId,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: content || null,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    },
                    finish_reason: (finishReason as any) || 'stop'
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            };
        }

        // We have tool calls - add assistant message to conversation
        conversationMessages.push({
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls
        });

        // Execute tool calls (limited)
        const callsToExecute = toolCalls.slice(0, maxToolCalls);
        const results = await toolRegistry.executeToolCalls(callsToExecute);

        // Add tool results to conversation
        for (const call of callsToExecute) {
            const result = results.get(call.id);
            conversationMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: result?.success 
                    ? (result.result || 'Tool executed successfully')
                    : `Error: ${result?.error || 'Unknown error'}`
            });
        }

        // Continue to next iteration to get model's response to tool results
    }

    // Max iterations reached - return with what we have
    return {
        id: completionId,
        object: 'chat.completion',
        created,
        model: fullId,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: 'Maximum tool iterations reached. Please try again with a simpler request.'
            },
            finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
}
