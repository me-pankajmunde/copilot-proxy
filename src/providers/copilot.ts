/**
 * GitHub Copilot Provider - wraps VS Code Language Model API
 */

import * as vscode from 'vscode';
import {
    IProvider,
    ProviderModelInfo,
    CompletionOptions,
    StreamChunk,
    CopilotProviderConfig
} from './types';
import { OpenAIMessage } from '../types';

export class CopilotProvider implements IProvider {
    readonly id = 'copilot';
    readonly name = 'GitHub Copilot';
    
    private _enabled: boolean = true;
    private models: vscode.LanguageModelChat[] = [];
    private modelMap: Map<string, vscode.LanguageModelChat> = new Map();
    private modelInfoMap: Map<string, ProviderModelInfo> = new Map();
    private disposable: vscode.Disposable | null = null;

    constructor(config?: CopilotProviderConfig) {
        this._enabled = config?.enabled ?? true;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    async initialize(): Promise<void> {
        await this.refreshModels();
        
        // Listen for model changes
        this.disposable = vscode.lm.onDidChangeChatModels(async () => {
            await this.refreshModels();
        });
    }

    private async refreshModels(): Promise<void> {
        try {
            this.models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            this.modelMap.clear();
            this.modelInfoMap.clear();

            for (const model of this.models) {
                // Map by id
                this.modelMap.set(model.id, model);
                // Also map by family for convenience
                this.modelMap.set(model.family, model);

                const modelInfo: ProviderModelInfo = {
                    id: model.id,
                    name: model.name,
                    providerId: this.id,
                    description: `${model.family} via GitHub Copilot`,
                    maxInputTokens: model.maxInputTokens
                };
                
                this.modelInfoMap.set(model.id, modelInfo);
                this.modelInfoMap.set(model.family, modelInfo);
            }

            console.log(`[Copilot Provider] Discovered ${this.models.length} models:`,
                this.models.map(m => m.id).join(', '));
        } catch (err) {
            console.error('[Copilot Provider] Failed to discover models:', err);
            this.models = [];
            this.modelMap.clear();
            this.modelInfoMap.clear();
        }
    }

    async getModels(): Promise<ProviderModelInfo[]> {
        // Return unique models (by id, not family duplicates)
        const seen = new Set<string>();
        const result: ProviderModelInfo[] = [];
        
        for (const model of this.models) {
            if (!seen.has(model.id)) {
                seen.add(model.id);
                result.push(this.modelInfoMap.get(model.id)!);
            }
        }
        
        return result;
    }

    getModel(modelId: string): ProviderModelInfo | undefined {
        return this.modelInfoMap.get(modelId);
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
        const model = this.modelMap.get(modelId);
        if (!model) {
            throw new Error(`Model '${modelId}' not found in Copilot provider`);
        }

        // Convert to VS Code messages
        const vsCodeMessages = this.convertMessages(messages);

        // Create cancellation token from abort signal
        const cts = new vscode.CancellationTokenSource();
        signal.addEventListener('abort', () => cts.cancel());

        try {
            const response = await model.sendRequest(
                vsCodeMessages,
                {
                    justification: 'OpenAI-compatible API request via Copilot Proxy'
                },
                cts.token
            );

            for await (const fragment of response.text) {
                if (signal.aborted) {
                    break;
                }
                yield { content: fragment, finishReason: null };
            }

            yield { content: '', finishReason: 'stop' };
        } finally {
            cts.dispose();
        }
    }

    /**
     * Convert OpenAI messages to VS Code LanguageModelChatMessage format
     * System messages are prepended to the first user message since
     * the VS Code LM API doesn't support system role directly.
     */
    private convertMessages(messages: OpenAIMessage[]): vscode.LanguageModelChatMessage[] {
        const result: vscode.LanguageModelChatMessage[] = [];
        let systemContent = '';

        // Collect system messages
        for (const msg of messages) {
            if (msg.role === 'system') {
                systemContent += (systemContent ? '\n' : '') + (msg.content || '');
            }
        }

        // Process non-system messages
        for (const msg of messages) {
            if (msg.role === 'system') {
                continue;
            }

            if (msg.role === 'assistant') {
                result.push(vscode.LanguageModelChatMessage.Assistant(msg.content || ''));
            } else if (msg.role === 'user' || msg.role === 'tool') {
                const content = msg.content || '';
                // Prepend system content to first user message
                if (result.length === 0 && systemContent) {
                    const combinedContent = `${systemContent}\n\n---\n\n${content}`;
                    result.push(vscode.LanguageModelChatMessage.User(combinedContent));
                    systemContent = '';
                } else {
                    result.push(vscode.LanguageModelChatMessage.User(content));
                }
            }
        }

        // If we only had system messages
        if (result.length === 0 && systemContent) {
            result.push(vscode.LanguageModelChatMessage.User(systemContent));
        }

        return result;
    }

    dispose(): void {
        if (this.disposable) {
            this.disposable.dispose();
            this.disposable = null;
        }
    }
}
