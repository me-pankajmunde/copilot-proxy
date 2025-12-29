/**
 * Provider Registry - manages all providers and provides unified model lookup
 */

import * as vscode from 'vscode';
import {
    IProvider,
    ProviderModelInfo,
    UnifiedModelInfo,
    ModelLookupResult,
    ProvidersConfig
} from './types';

/**
 * Registry for managing multiple LLM providers
 */
export class ProviderRegistry {
    private providers: Map<string, IProvider> = new Map();
    private modelCache: Map<string, ModelLookupResult> = new Map();
    private initialized: boolean = false;

    constructor() {}

    /**
     * Register a provider
     */
    registerProvider(provider: IProvider): void {
        if (this.providers.has(provider.id)) {
            console.warn(`[Provider Registry] Provider '${provider.id}' already registered, replacing...`);
        }
        this.providers.set(provider.id, provider);
        console.log(`[Provider Registry] Registered provider: ${provider.id}`);
    }

    /**
     * Unregister a provider
     */
    unregisterProvider(providerId: string): void {
        const provider = this.providers.get(providerId);
        if (provider) {
            provider.dispose();
            this.providers.delete(providerId);
            this.invalidateModelCache();
            console.log(`[Provider Registry] Unregistered provider: ${providerId}`);
        }
    }

    /**
     * Get a provider by ID
     */
    getProvider(providerId: string): IProvider | undefined {
        return this.providers.get(providerId);
    }

    /**
     * Get all registered providers
     */
    getAllProviders(): IProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get all enabled providers
     */
    getEnabledProviders(): IProvider[] {
        return Array.from(this.providers.values()).filter(p => p.enabled);
    }

    /**
     * Initialize all registered providers
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const initPromises = Array.from(this.providers.values()).map(async provider => {
            try {
                await provider.initialize();
                console.log(`[Provider Registry] Initialized provider: ${provider.id}`);
            } catch (err) {
                console.error(`[Provider Registry] Failed to initialize provider '${provider.id}':`, err);
            }
        });

        await Promise.all(initPromises);
        await this.refreshModelCache();
        this.initialized = true;
    }

    /**
     * Refresh the model cache from all providers
     */
    async refreshModelCache(): Promise<void> {
        this.modelCache.clear();

        for (const provider of this.getEnabledProviders()) {
            try {
                const models = await provider.getModels();
                for (const model of models) {
                    const fullId = `${provider.id}/${model.id}`;
                    const lookupResult: ModelLookupResult = {
                        provider,
                        model,
                        fullId
                    };
                    
                    // Store by full ID
                    this.modelCache.set(fullId, lookupResult);
                    
                    // Also store by model ID alone for convenience
                    // Only if not already taken by another provider
                    if (!this.modelCache.has(model.id)) {
                        this.modelCache.set(model.id, lookupResult);
                    }
                }
            } catch (err) {
                console.error(`[Provider Registry] Failed to get models from '${provider.id}':`, err);
            }
        }

        console.log(`[Provider Registry] Cached ${this.modelCache.size} models`);
    }

    /**
     * Invalidate the model cache
     */
    invalidateModelCache(): void {
        this.modelCache.clear();
    }

    /**
     * Lookup a model by ID (supports both 'provider/model' and 'model' formats)
     */
    lookupModel(modelId: string): ModelLookupResult | undefined {
        return this.modelCache.get(modelId);
    }

    /**
     * Get all available models as unified model info
     */
    async getAllModels(): Promise<UnifiedModelInfo[]> {
        const models: UnifiedModelInfo[] = [];
        const seenFullIds = new Set<string>();

        for (const provider of this.getEnabledProviders()) {
            try {
                const providerModels = await provider.getModels();
                for (const model of providerModels) {
                    const fullId = `${provider.id}/${model.id}`;
                    if (!seenFullIds.has(fullId)) {
                        seenFullIds.add(fullId);
                        models.push({
                            ...model,
                            fullId
                        });
                    }
                }
            } catch (err) {
                console.error(`[Provider Registry] Failed to get models from '${provider.id}':`, err);
            }
        }

        return models;
    }

    /**
     * Get models grouped by provider
     */
    async getModelsByProvider(): Promise<Map<string, ProviderModelInfo[]>> {
        const result = new Map<string, ProviderModelInfo[]>();

        for (const provider of this.getEnabledProviders()) {
            try {
                const models = await provider.getModels();
                result.set(provider.id, models);
            } catch (err) {
                console.error(`[Provider Registry] Failed to get models from '${provider.id}':`, err);
                result.set(provider.id, []);
            }
        }

        return result;
    }

    /**
     * Check if any models are available
     */
    hasModels(): boolean {
        return this.modelCache.size > 0;
    }

    /**
     * Dispose all providers
     */
    dispose(): void {
        for (const provider of this.providers.values()) {
            try {
                provider.dispose();
            } catch (err) {
                console.error(`[Provider Registry] Error disposing provider '${provider.id}':`, err);
            }
        }
        this.providers.clear();
        this.modelCache.clear();
        this.initialized = false;
    }
}

// Singleton instance
let registryInstance: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
    if (!registryInstance) {
        registryInstance = new ProviderRegistry();
    }
    return registryInstance;
}

export function disposeProviderRegistry(): void {
    if (registryInstance) {
        registryInstance.dispose();
        registryInstance = null;
    }
}

/**
 * Load provider configuration from VS Code settings
 */
export function loadProvidersConfig(): ProvidersConfig {
    const config = vscode.workspace.getConfiguration('copilot-proxy');
    const providersConfig = config.get<ProvidersConfig>('providers', {
        copilot: { enabled: true },
        openai: { enabled: false, apiKey: '' },
        'azure-openai': { enabled: false, endpoint: '', apiKey: '' },
        ollama: { enabled: false, baseUrl: 'http://localhost:11434' }
    });

    // Resolve environment variables in API keys
    return resolveEnvVariables(providersConfig);
}

/**
 * Resolve ${env:VAR_NAME} patterns in configuration
 */
function resolveEnvVariables(config: ProvidersConfig): ProvidersConfig {
    const resolved = JSON.parse(JSON.stringify(config)) as ProvidersConfig;
    
    const resolveString = (value: string): string => {
        return value.replace(/\$\{env:(\w+)\}/g, (_, varName) => {
            return process.env[varName] || '';
        });
    };

    if (resolved.openai?.apiKey) {
        resolved.openai.apiKey = resolveString(resolved.openai.apiKey);
    }
    if (resolved['azure-openai']?.apiKey) {
        resolved['azure-openai'].apiKey = resolveString(resolved['azure-openai'].apiKey);
    }
    if (resolved['azure-openai']?.endpoint) {
        resolved['azure-openai'].endpoint = resolveString(resolved['azure-openai'].endpoint);
    }

    return resolved;
}
