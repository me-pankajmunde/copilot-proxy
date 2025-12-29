import * as vscode from 'vscode';
import { ModelInfo } from './types';

/**
 * Model discovery and caching service
 */
export class ModelService {
    private models: vscode.LanguageModelChat[] = [];
    private modelMap: Map<string, vscode.LanguageModelChat> = new Map();
    private disposable: vscode.Disposable | null = null;

    constructor() {}

    /**
     * Initialize the model service and start listening for model changes
     */
    async initialize(): Promise<void> {
        await this.refreshModels();
        
        // Listen for model changes
        this.disposable = vscode.lm.onDidChangeChatModels(async () => {
            await this.refreshModels();
        });
    }

    /**
     * Refresh the list of available models
     */
    async refreshModels(): Promise<void> {
        try {
            this.models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            this.modelMap.clear();
            
            for (const model of this.models) {
                // Map by id
                this.modelMap.set(model.id, model);
                // Also map by family for convenience (e.g., "gpt-4o" instead of full id)
                this.modelMap.set(model.family, model);
            }
            
            console.log(`[Copilot Proxy] Discovered ${this.models.length} models:`, 
                this.models.map(m => m.id).join(', '));
        } catch (err) {
            console.error('[Copilot Proxy] Failed to discover models:', err);
            this.models = [];
            this.modelMap.clear();
        }
    }

    /**
     * Get all available models as ModelInfo
     */
    getModels(): ModelInfo[] {
        return this.models.map(model => ({
            id: model.id,
            name: model.name,
            family: model.family,
            version: model.version,
            maxInputTokens: model.maxInputTokens,
            vendor: model.vendor
        }));
    }

    /**
     * Get a model by id or family name
     */
    getModel(idOrFamily: string): vscode.LanguageModelChat | undefined {
        return this.modelMap.get(idOrFamily);
    }

    /**
     * Get the raw LanguageModelChat instances
     */
    getRawModels(): vscode.LanguageModelChat[] {
        return this.models;
    }

    /**
     * Check if any models are available
     */
    hasModels(): boolean {
        return this.models.length > 0;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.disposable) {
            this.disposable.dispose();
            this.disposable = null;
        }
    }
}

// Singleton instance
let modelServiceInstance: ModelService | null = null;

export function getModelService(): ModelService {
    if (!modelServiceInstance) {
        modelServiceInstance = new ModelService();
    }
    return modelServiceInstance;
}

export function disposeModelService(): void {
    if (modelServiceInstance) {
        modelServiceInstance.dispose();
        modelServiceInstance = null;
    }
}
