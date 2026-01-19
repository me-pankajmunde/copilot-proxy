import * as http from 'http';
import { 
    AnthropicRequest, 
    AnthropicResponse, 
    AnthropicStreamEvent,
    AnthropicMessageStartEvent,
    AnthropicContentBlockStartEvent,
    AnthropicContentBlockDeltaEvent,
    AnthropicContentBlockStopEvent,
    AnthropicMessageDeltaEvent,
    AnthropicMessageStopEvent,
    OpenAIMessage,
    AnthropicMessage
} from '../types';
import { getProviderRegistry } from '../providers/registry';
import { CompletionOptions } from '../providers/types';
import { getLoggingService } from '../logging';
import { getCacheService } from '../cache';

/**
 * Parse request body
 */
async function parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON in request body'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Send error response in Anthropic format
 */
function sendError(
    res: http.ServerResponse,
    statusCode: number,
    type: string,
    message: string
): void {
    if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({
        type: 'error',
        error: {
            type,
            message
        }
    }));
}

/**
 * Convert Anthropic messages to OpenAI format
 */
function convertAnthropicToOpenAI(
    messages: AnthropicMessage[],
    systemParam?: string
): OpenAIMessage[] {
    const openAIMessages: OpenAIMessage[] = [];
    
    // Collect system messages from the messages array
    const systemMessages: string[] = [];
    const nonSystemMessages: AnthropicMessage[] = [];
    
    for (const msg of messages) {
        // Anthropic doesn't support system role in messages, but we'll check anyway
        // for flexibility
        if ((msg as any).role === 'system') {
            const content = typeof msg.content === 'string' 
                ? msg.content 
                : msg.content.map(c => c.text).join('');
            systemMessages.push(content);
        } else {
            nonSystemMessages.push(msg);
        }
    }
    
    // Add explicit system parameter if provided (takes precedence)
    if (systemParam) {
        systemMessages.unshift(systemParam);
    }
    
    // Add combined system message if any exist
    if (systemMessages.length > 0) {
        openAIMessages.push({
            role: 'system',
            content: systemMessages.join('\n\n')
        });
    }
    
    // Convert remaining messages
    for (const msg of nonSystemMessages) {
        const content = typeof msg.content === 'string'
            ? msg.content
            : msg.content.map(c => c.text).join('');
        
        openAIMessages.push({
            role: msg.role,
            content
        });
    }
    
    return openAIMessages;
}

/**
 * Generate a completion ID in Anthropic format
 */
function generateCompletionId(): string {
    return `msg_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Handle streaming response with Anthropic event format
 */
async function handleAnthropicStreamingResponse(
    res: http.ServerResponse,
    chunks: AsyncIterable<{ content: string; finishReason?: string | null }>,
    modelId: string,
    completionId: string,
    onComplete: (response: string) => void
): Promise<void> {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let fullContent = '';
    let hasStarted = false;

    try {
        for await (const chunk of chunks) {
            // Send message_start event (only once)
            if (!hasStarted) {
                const messageStart: AnthropicMessageStartEvent = {
                    type: 'message_start',
                    message: {
                        id: completionId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        model: modelId,
                        stop_reason: null,
                        stop_sequence: null,
                        usage: {
                            input_tokens: 0,
                            output_tokens: 0
                        }
                    }
                };
                res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

                // Send content_block_start event
                const blockStart: AnthropicContentBlockStartEvent = {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {
                        type: 'text',
                        text: ''
                    }
                };
                res.write(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);

                hasStarted = true;
            }

            // Send content delta
            if (chunk.content) {
                fullContent += chunk.content;
                
                const delta: AnthropicContentBlockDeltaEvent = {
                    type: 'content_block_delta',
                    index: 0,
                    delta: {
                        type: 'text_delta',
                        text: chunk.content
                    }
                };
                res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
            }

            // Handle finish
            if (chunk.finishReason) {
                // Send content_block_stop
                const blockStop: AnthropicContentBlockStopEvent = {
                    type: 'content_block_stop',
                    index: 0
                };
                res.write(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`);

                // Map finish reasons
                let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' = 'end_turn';
                if (chunk.finishReason === 'length') {
                    stopReason = 'max_tokens';
                } else if (chunk.finishReason === 'stop') {
                    stopReason = 'end_turn';
                }

                // Send message_delta
                const messageDelta: AnthropicMessageDeltaEvent = {
                    type: 'message_delta',
                    delta: {
                        stop_reason: stopReason,
                        stop_sequence: null
                    },
                    usage: {
                        output_tokens: 0
                    }
                };
                res.write(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`);

                // Send message_stop
                const messageStop: AnthropicMessageStopEvent = {
                    type: 'message_stop'
                };
                res.write(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`);
                
                break;
            }
        }

        res.end();
        onComplete(fullContent);
    } catch (err) {
        console.error('[Anthropic Handler] Streaming error:', err);
        if (!res.headersSent) {
            sendError(res, 500, 'internal_error', err instanceof Error ? err.message : 'Streaming error');
        }
    }
}

/**
 * Handle non-streaming response in Anthropic format
 */
async function handleAnthropicNonStreamingResponse(
    res: http.ServerResponse,
    chunks: AsyncIterable<{ content: string; finishReason?: string | null }>,
    modelId: string,
    completionId: string
): Promise<string> {
    let content = '';
    let finishReason: 'end_turn' | 'max_tokens' | 'stop_sequence' = 'end_turn';

    for await (const chunk of chunks) {
        content += chunk.content;
        
        if (chunk.finishReason === 'length') {
            finishReason = 'max_tokens';
        } else if (chunk.finishReason === 'stop') {
            finishReason = 'end_turn';
        }
    }

    const response: AnthropicResponse = {
        id: completionId,
        type: 'message',
        role: 'assistant',
        content: [{
            type: 'text',
            text: content
        }],
        model: modelId,
        stop_reason: finishReason,
        stop_sequence: null,
        usage: {
            input_tokens: 0,
            output_tokens: 0
        }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));

    return content;
}

/**
 * Handle POST /anthropic/v1/messages
 */
export async function handleAnthropicMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    try {
        // Parse request
        const body = await parseBody(req) as AnthropicRequest;

        // Validate required fields
        if (!body.model) {
            sendError(res, 400, 'invalid_request_error', 'Missing required field: model');
            return;
        }

        if (!body.messages || !Array.isArray(body.messages)) {
            sendError(res, 400, 'invalid_request_error', 'Missing required field: messages');
            return;
        }

        if (body.messages.length === 0) {
            sendError(res, 400, 'invalid_request_error', 'messages array cannot be empty');
            return;
        }

        if (!body.max_tokens) {
            sendError(res, 400, 'invalid_request_error', 'Missing required field: max_tokens');
            return;
        }

        // Look up model
        const registry = getProviderRegistry();
        const lookup = registry.lookupModel(body.model);

        if (!lookup) {
            sendError(res, 404, 'not_found_error', `Model '${body.model}' not found`);
            return;
        }

        const { provider, model, fullId } = lookup;

        // Convert messages
        const openAIMessages = convertAnthropicToOpenAI(body.messages, body.system);

        // Build completion options
        const options: CompletionOptions = {
            maxTokens: body.max_tokens,
            temperature: body.temperature,
            topP: body.top_p,
            stop: body.stop_sequences
        };

        // Check for streaming
        const streaming = body.stream === true;

        // Generate completion ID
        const completionId = generateCompletionId();

        // Check cache
        const cacheService = getCacheService();
        const loggingService = getLoggingService();
        const cachedResponse = cacheService.get(provider.id, model.id, openAIMessages, options);

        // Start logging
        const log = loggingService.startLog(provider.id, model.id, openAIMessages, options, streaming);

        if (cachedResponse) {
            if (streaming) {
                await handleAnthropicStreamingResponse(
                    res,
                    (async function*() {
                        yield { content: cachedResponse, finishReason: null };
                        yield { content: '', finishReason: 'stop' };
                    })(),
                    fullId,
                    completionId,
                    (response) => {
                        log.complete(response, undefined, true);
                    }
                );
            } else {
                await handleAnthropicNonStreamingResponse(
                    res,
                    (async function*() {
                        yield { content: cachedResponse, finishReason: 'stop' };
                    })(),
                    fullId,
                    completionId
                );
                log.complete(cachedResponse, undefined, true);
            }
            return;
        }

        // Create abort controller
        const abortController = new AbortController();
        req.on('close', () => abortController.abort());

        // Get completion from provider
        const chunks = provider.sendChatCompletion(
            model.id,
            openAIMessages,
            options,
            abortController.signal
        );

        if (streaming) {
            await handleAnthropicStreamingResponse(
                res,
                chunks,
                fullId,
                completionId,
                (response) => {
                    log.complete(response);
                    cacheService.set(provider.id, model.id, openAIMessages, options, response);
                }
            );
        } else {
            const response = await handleAnthropicNonStreamingResponse(
                res,
                chunks,
                fullId,
                completionId
            );
            log.complete(response);
            cacheService.set(provider.id, model.id, openAIMessages, options, response);
        }
    } catch (err) {
        console.error('[Anthropic Handler] Error:', err);
        sendError(
            res, 
            500, 
            'internal_error', 
            err instanceof Error ? err.message : 'Internal server error'
        );
    }
}
