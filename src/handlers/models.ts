import * as http from 'http';
import { getProviderRegistry } from '../providers/registry';
import { ModelsListResponse, ModelObject } from '../types';

/**
 * Handle GET /v1/models
 * Returns a list of available models in OpenAI format
 */
export async function handleListModels(
    _req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> {
    const registry = getProviderRegistry();
    const models = await registry.getAllModels();

    const modelList: ModelsListResponse = {
        object: 'list',
        data: models.map((model): ModelObject => ({
            id: model.fullId,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: model.providerId
        }))
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(modelList, null, 2));
}

/**
 * Handle GET /v1/models/:model_id
 * Returns information about a specific model
 */
export async function handleGetModel(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    modelId: string
): Promise<void> {
    const registry = getProviderRegistry();
    const lookup = registry.lookupModel(modelId);

    if (!lookup) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: `Model '${modelId}' not found`,
                type: 'invalid_request_error',
                param: 'model',
                code: 'model_not_found'
            }
        }));
        return;
    }

    const modelObject: ModelObject = {
        id: lookup.fullId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: lookup.provider.id
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(modelObject, null, 2));
}
