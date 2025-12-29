/**
 * Multi-model comparison handler
 */

import * as http from 'http';
import { getProviderRegistry } from '../providers/registry';
import { getLoggingService } from '../logging';
import {
    CompareRequest,
    CompareResponse,
    CompareModelResult,
    CompletionOptions
} from '../providers/types';
import { OpenAIMessage } from '../types';

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
 * Run completion for a single model
 */
async function runCompletion(
    modelId: string,
    messages: OpenAIMessage[],
    options: CompletionOptions,
    signal: AbortSignal
): Promise<CompareModelResult> {
    const startTime = Date.now();
    const registry = getProviderRegistry();
    const lookup = registry.lookupModel(modelId);

    if (!lookup) {
        return {
            model: modelId,
            provider: 'unknown',
            error: `Model '${modelId}' not found`,
            latencyMs: Date.now() - startTime
        };
    }

    const { provider, model, fullId } = lookup;

    try {
        const chunks = provider.sendChatCompletion(
            model.id,
            messages,
            options,
            signal
        );

        let content = '';
        for await (const chunk of chunks) {
            content += chunk.content;
        }

        return {
            model: fullId,
            provider: provider.id,
            response: content,
            latencyMs: Date.now() - startTime
        };
    } catch (err) {
        return {
            model: fullId,
            provider: provider.id,
            error: err instanceof Error ? err.message : 'Unknown error',
            latencyMs: Date.now() - startTime
        };
    }
}

/**
 * Handle POST /v1/chat/completions/compare
 * Sends the same prompt to multiple models and returns results
 */
export async function handleCompare(
    req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    let body: CompareRequest;

    try {
        body = await parseBody<CompareRequest>(req);
    } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Invalid JSON in request body',
                type: 'invalid_request_error',
                code: 'invalid_json'
            }
        }));
        return;
    }

    // Validate request
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Missing required field: messages',
                type: 'invalid_request_error',
                code: 'missing_required_field'
            }
        }));
        return;
    }

    if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Missing required field: models (array of model IDs to compare)',
                type: 'invalid_request_error',
                code: 'missing_required_field'
            }
        }));
        return;
    }

    if (body.models.length > 10) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'Maximum 10 models can be compared at once',
                type: 'invalid_request_error',
                code: 'too_many_models'
            }
        }));
        return;
    }

    const options: CompletionOptions = body.options || {};
    
    // Create abort controller
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    // Run completions in parallel
    const results = await Promise.all(
        body.models.map(modelId =>
            runCompletion(modelId, body.messages, options, abortController.signal)
        )
    );

    // Log all requests
    const loggingService = getLoggingService();
    for (const result of results) {
        const log = loggingService.startLog(
            result.provider,
            result.model,
            body.messages,
            options,
            false
        );
        log.complete(result.response, result.error);
    }

    const response: CompareResponse = {
        id: `compare-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        created: Math.floor(Date.now() / 1000),
        results
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
}

/**
 * Handle GET /v1/providers
 * Returns list of configured providers and their status
 */
export async function handleListProviders(
    _req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    const registry = getProviderRegistry();
    const providers = registry.getAllProviders();

    const providerList = await Promise.all(
        providers.map(async provider => {
            const models = await provider.getModels();
            return {
                id: provider.id,
                name: provider.name,
                enabled: provider.enabled,
                modelCount: models.length
            };
        })
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        object: 'list',
        data: providerList
    }, null, 2));
}
