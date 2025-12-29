/**
 * Ollama Provider - local LLM inference via Ollama
 */

import {
    IProvider,
    ProviderModelInfo,
    CompletionOptions,
    StreamChunk,
    OllamaProviderConfig
} from './types';
import { OpenAIMessage } from '../types';

interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details?: {
        format?: string;
        family?: string;
        parameter_size?: string;
        quantization_level?: string;
    };
}

interface OllamaModelsResponse {
    models: OllamaModel[];
}

export class OllamaProvider implements IProvider {
    readonly id = 'ollama';
    readonly name = 'Ollama';

    private _enabled: boolean = false;
    private baseUrl: string = 'http://localhost:11434';
    private models: ProviderModelInfo[] = [];
    private modelMap: Map<string, ProviderModelInfo> = new Map();

    constructor(config?: OllamaProviderConfig) {
        if (config) {
            this._enabled = config.enabled;
            this.baseUrl = config.baseUrl || 'http://localhost:11434';
        }
    }

    get enabled(): boolean {
        return this._enabled;
    }

    async initialize(): Promise<void> {
        if (!this.enabled) {
            console.log('[Ollama Provider] Disabled');
            return;
        }

        await this.refreshModels();
    }

    private async refreshModels(): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json() as OllamaModelsResponse;

            this.models = data.models.map(m => ({
                id: m.name,
                name: m.name,
                providerId: this.id,
                description: this.formatModelDescription(m)
            }));

            // Build model map
            this.modelMap.clear();
            for (const model of this.models) {
                this.modelMap.set(model.id, model);
                // Also map without tag (e.g., 'llama2' for 'llama2:latest')
                const baseName = model.id.split(':')[0];
                if (!this.modelMap.has(baseName)) {
                    this.modelMap.set(baseName, model);
                }
            }

            console.log(`[Ollama Provider] Found ${this.models.length} models`);
        } catch (err) {
            console.warn('[Ollama Provider] Could not connect to Ollama:', err);
            this.models = [];
            this.modelMap.clear();
        }
    }

    private formatModelDescription(model: OllamaModel): string {
        const parts: string[] = [];
        if (model.details?.family) {
            parts.push(model.details.family);
        }
        if (model.details?.parameter_size) {
            parts.push(model.details.parameter_size);
        }
        if (model.details?.quantization_level) {
            parts.push(model.details.quantization_level);
        }
        return parts.length > 0 ? parts.join(', ') : 'Local model';
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        // Refresh models on each call to catch newly pulled models
        await this.refreshModels();
        return this.models;
    }

    getModel(modelId: string): ProviderModelInfo | undefined {
        return this.modelMap.get(modelId);
    }

    hasModel(modelId: string): boolean {
        return this.modelMap.has(modelId);
    }

    async *sendChatCompletion(
        modelId: string,
        messages: OpenAIMessage[],
        options: CompletionOptions,
        signal: AbortSignal
    ): AsyncIterable<StreamChunk> {
        // Ollama uses OpenAI-compatible API at /v1/chat/completions
        // or native API at /api/chat - we'll use the OpenAI-compatible one
        const requestBody = {
            model: modelId,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            stream: true,
            options: {
                ...(options.temperature !== undefined && { temperature: options.temperature }),
                ...(options.topP !== undefined && { top_p: options.topP }),
                ...(options.stop && { stop: options.stop })
            }
        };

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error: ${error}`);
        }

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);
                        
                        if (parsed.message?.content) {
                            yield { content: parsed.message.content, finishReason: null };
                        }

                        if (parsed.done) {
                            yield { content: '', finishReason: 'stop' };
                            return;
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    dispose(): void {
        // Nothing to dispose
    }
}
