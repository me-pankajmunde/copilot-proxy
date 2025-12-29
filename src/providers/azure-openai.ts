/**
 * Azure OpenAI Provider - Azure-hosted OpenAI models
 */

import {
    IProvider,
    ProviderModelInfo,
    CompletionOptions,
    StreamChunk,
    AzureOpenAIProviderConfig
} from './types';
import { OpenAIMessage } from '../types';

export class AzureOpenAIProvider implements IProvider {
    readonly id = 'azure-openai';
    readonly name = 'Azure OpenAI';

    private _enabled: boolean = false;
    private endpoint: string = '';
    private apiKey: string = '';
    private apiVersion: string = '2024-02-15-preview';
    private deployments: { [modelName: string]: string } = {};
    private models: ProviderModelInfo[] = [];
    private modelMap: Map<string, ProviderModelInfo> = new Map();

    constructor(config?: AzureOpenAIProviderConfig) {
        if (config) {
            this._enabled = config.enabled && !!config.apiKey && !!config.endpoint;
            this.endpoint = config.endpoint?.replace(/\/$/, '') || '';
            this.apiKey = config.apiKey || '';
            this.apiVersion = config.apiVersion || '2024-02-15-preview';
            this.deployments = config.deployments || {};
        }
    }

    get enabled(): boolean {
        return this._enabled && !!this.apiKey && !!this.endpoint;
    }

    async initialize(): Promise<void> {
        if (!this.enabled) {
            console.log('[Azure OpenAI Provider] Disabled or not configured');
            return;
        }

        await this.refreshModels();
    }

    private async refreshModels(): Promise<void> {
        try {
            // Try to list deployments from Azure
            const response = await fetch(
                `${this.endpoint}/openai/deployments?api-version=${this.apiVersion}`,
                {
                    headers: {
                        'api-key': this.apiKey
                    }
                }
            );

            if (response.ok) {
                const data = await response.json() as { data: Array<{ id: string; model: string }> };
                this.models = data.data.map(d => ({
                    id: d.id,
                    name: d.id,
                    providerId: this.id,
                    description: `Azure deployment: ${d.model || d.id}`
                }));

                // Update deployments mapping
                for (const deployment of data.data) {
                    this.deployments[deployment.id] = deployment.id;
                    if (deployment.model) {
                        this.deployments[deployment.model] = deployment.id;
                    }
                }
            } else {
                // Fall back to configured deployments
                this.models = Object.keys(this.deployments).map(name => ({
                    id: name,
                    name: name,
                    providerId: this.id,
                    description: `Azure deployment: ${this.deployments[name]}`
                }));
            }
        } catch (err) {
            console.warn('[Azure OpenAI Provider] Could not fetch deployments:', err);
            // Use configured deployments as fallback
            this.models = Object.keys(this.deployments).map(name => ({
                id: name,
                name: name,
                providerId: this.id,
                description: `Azure deployment: ${this.deployments[name]}`
            }));
        }

        // Build model map
        this.modelMap.clear();
        for (const model of this.models) {
            this.modelMap.set(model.id, model);
        }

        console.log(`[Azure OpenAI Provider] Available deployments: ${this.models.length}`);
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        return this.models;
    }

    getModel(modelId: string): ProviderModelInfo | undefined {
        return this.modelMap.get(modelId);
    }

    hasModel(modelId: string): boolean {
        return this.modelMap.has(modelId) || !!this.deployments[modelId];
    }

    private getDeploymentName(modelId: string): string {
        return this.deployments[modelId] || modelId;
    }

    async *sendChatCompletion(
        modelId: string,
        messages: OpenAIMessage[],
        options: CompletionOptions,
        signal: AbortSignal
    ): AsyncIterable<StreamChunk> {
        const deploymentName = this.getDeploymentName(modelId);
        
        const requestBody = {
            messages,
            stream: true,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
            ...(options.topP !== undefined && { top_p: options.topP }),
            ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
            ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
            ...(options.stop && { stop: options.stop })
        };

        const url = `${this.endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${this.apiVersion}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': this.apiKey
            },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } })) as { error?: { message?: string } };
            throw new Error(error.error?.message || `Azure OpenAI API error: ${response.status}`);
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
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        yield { content: '', finishReason: 'stop' };
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        const finishReason = parsed.choices?.[0]?.finish_reason;

                        if (delta?.content) {
                            yield { content: delta.content, finishReason: null };
                        }

                        if (finishReason) {
                            yield { content: '', finishReason };
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
