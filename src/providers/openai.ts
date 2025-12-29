/**
 * OpenAI Provider - direct API calls to OpenAI
 */

import {
    IProvider,
    ProviderModelInfo,
    CompletionOptions,
    StreamChunk,
    OpenAIProviderConfig
} from './types';
import { OpenAIMessage } from '../types';

// Default OpenAI models
const DEFAULT_MODELS: ProviderModelInfo[] = [
    { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', description: 'Most capable GPT-4 model', maxInputTokens: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', description: 'Fast and affordable', maxInputTokens: 128000 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', providerId: 'openai', description: 'GPT-4 Turbo with vision', maxInputTokens: 128000 },
    { id: 'gpt-4', name: 'GPT-4', providerId: 'openai', description: 'Original GPT-4', maxInputTokens: 8192 },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', providerId: 'openai', description: 'Fast and efficient', maxInputTokens: 16385 },
    { id: 'o1', name: 'o1', providerId: 'openai', description: 'Reasoning model', maxInputTokens: 128000 },
    { id: 'o1-mini', name: 'o1-mini', providerId: 'openai', description: 'Fast reasoning model', maxInputTokens: 128000 },
    { id: 'o1-preview', name: 'o1-preview', providerId: 'openai', description: 'Preview reasoning model', maxInputTokens: 128000 },
];

export class OpenAIProvider implements IProvider {
    readonly id = 'openai';
    readonly name = 'OpenAI';

    private _enabled: boolean = false;
    private apiKey: string = '';
    private baseUrl: string = 'https://api.openai.com/v1';
    private organization?: string;
    private models: ProviderModelInfo[] = [];
    private modelMap: Map<string, ProviderModelInfo> = new Map();

    constructor(config?: OpenAIProviderConfig) {
        if (config) {
            this._enabled = config.enabled && !!config.apiKey;
            this.apiKey = config.apiKey || '';
            this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
            this.organization = config.organization;
        }
    }

    get enabled(): boolean {
        return this._enabled && !!this.apiKey;
    }

    async initialize(): Promise<void> {
        if (!this.enabled) {
            console.log('[OpenAI Provider] Disabled or no API key configured');
            return;
        }

        await this.refreshModels();
    }

    private async refreshModels(): Promise<void> {
        try {
            // Try to fetch models from API
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...(this.organization && { 'OpenAI-Organization': this.organization })
                }
            });

            if (response.ok) {
                const data = await response.json() as { data: Array<{ id: string }> };
                // Filter to chat models only
                const chatModels = data.data
                    .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o1'))
                    .map(m => ({
                        id: m.id,
                        name: m.id,
                        providerId: this.id,
                        description: `OpenAI ${m.id}`
                    }));

                if (chatModels.length > 0) {
                    this.models = chatModels;
                } else {
                    // Fall back to default models
                    this.models = DEFAULT_MODELS;
                }
            } else {
                // Fall back to default models
                console.warn('[OpenAI Provider] Could not fetch models, using defaults');
                this.models = DEFAULT_MODELS;
            }
        } catch (err) {
            console.warn('[OpenAI Provider] Error fetching models, using defaults:', err);
            this.models = DEFAULT_MODELS;
        }

        // Build model map
        this.modelMap.clear();
        for (const model of this.models) {
            this.modelMap.set(model.id, model);
        }

        console.log(`[OpenAI Provider] Available models: ${this.models.length}`);
    }

    async getModels(): Promise<ProviderModelInfo[]> {
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
        const requestBody = {
            model: modelId,
            messages,
            stream: true,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
            ...(options.topP !== undefined && { top_p: options.topP }),
            ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
            ...(options.presencePenalty !== undefined && { presence_penalty: options.presencePenalty }),
            ...(options.stop && { stop: options.stop })
        };

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                ...(this.organization && { 'OpenAI-Organization': this.organization })
            },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } })) as { error?: { message?: string } };
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
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
