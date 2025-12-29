/**
 * Provider abstraction layer types
 */

import { OpenAIMessage } from '../types';

/**
 * Model information from a provider
 */
export interface ProviderModelInfo {
    id: string;
    name: string;
    providerId: string;
    description?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    contextWindow?: number;
}

/**
 * Unified model info with provider prefix
 */
export interface UnifiedModelInfo extends ProviderModelInfo {
    /** Full model ID with provider prefix: provider/model-id */
    fullId: string;
}

/**
 * Options for chat completion requests
 */
export interface CompletionOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string | string[];
}

/**
 * Chunk from streaming response
 */
export interface StreamChunk {
    content: string;
    finishReason?: 'stop' | 'length' | 'content_filter' | null;
}

/**
 * Provider configuration base
 */
export interface ProviderConfig {
    enabled: boolean;
}

/**
 * OpenAI provider configuration
 */
export interface OpenAIProviderConfig extends ProviderConfig {
    apiKey: string;
    baseUrl?: string;
    organization?: string;
}

/**
 * Azure OpenAI provider configuration
 */
export interface AzureOpenAIProviderConfig extends ProviderConfig {
    endpoint: string;
    apiKey: string;
    apiVersion?: string;
    deployments?: { [modelName: string]: string };
}

/**
 * Ollama provider configuration
 */
export interface OllamaProviderConfig extends ProviderConfig {
    baseUrl?: string;
}

/**
 * Copilot provider configuration
 */
export interface CopilotProviderConfig extends ProviderConfig {
    // No additional config needed - uses VS Code LM API
}

/**
 * All providers configuration
 */
export interface ProvidersConfig {
    copilot?: CopilotProviderConfig;
    openai?: OpenAIProviderConfig;
    'azure-openai'?: AzureOpenAIProviderConfig;
    ollama?: OllamaProviderConfig;
}

/**
 * Provider interface that all providers must implement
 */
export interface IProvider {
    /** Unique identifier for this provider */
    readonly id: string;
    
    /** Display name for this provider */
    readonly name: string;
    
    /** Whether this provider is currently enabled */
    readonly enabled: boolean;

    /**
     * Initialize the provider
     * Called once when the provider is registered
     */
    initialize(): Promise<void>;

    /**
     * Get all available models from this provider
     */
    getModels(): Promise<ProviderModelInfo[]>;

    /**
     * Get a specific model by ID
     */
    getModel(modelId: string): ProviderModelInfo | undefined;

    /**
     * Check if a model exists
     */
    hasModel(modelId: string): boolean;

    /**
     * Send a chat completion request
     * @param modelId The model ID (without provider prefix)
     * @param messages The messages to send
     * @param options Completion options
     * @param signal Abort signal for cancellation
     * @returns Async iterable of content chunks
     */
    sendChatCompletion(
        modelId: string,
        messages: OpenAIMessage[],
        options: CompletionOptions,
        signal: AbortSignal
    ): AsyncIterable<StreamChunk>;

    /**
     * Clean up resources
     */
    dispose(): void;
}

/**
 * Provider registration info
 */
export interface ProviderRegistration {
    provider: IProvider;
    models: Map<string, ProviderModelInfo>;
}

/**
 * Model lookup result
 */
export interface ModelLookupResult {
    provider: IProvider;
    model: ProviderModelInfo;
    fullId: string;
}

/**
 * Request logging entry
 */
export interface RequestLogEntry {
    id: string;
    timestamp: Date;
    provider: string;
    model: string;
    messages: OpenAIMessage[];
    options: CompletionOptions;
    response?: string;
    error?: string;
    latencyMs: number;
    streaming: boolean;
    cached: boolean;
}

/**
 * Comparison request
 */
export interface CompareRequest {
    messages: OpenAIMessage[];
    models: string[];
    options?: CompletionOptions;
}

/**
 * Comparison result for a single model
 */
export interface CompareModelResult {
    model: string;
    provider: string;
    response?: string;
    error?: string;
    latencyMs: number;
}

/**
 * Comparison response
 */
export interface CompareResponse {
    id: string;
    created: number;
    results: CompareModelResult[];
}
