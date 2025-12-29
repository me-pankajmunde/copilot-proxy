/**
 * OpenAI API compatible type definitions
 */

// Request types
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatCompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    user?: string;
}

// Response types
export interface ChatCompletionChoice {
    index: number;
    message: {
        role: 'assistant';
        content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionChunkChoice {
    index: number;
    delta: {
        role?: 'assistant';
        content?: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: ChatCompletionChunkChoice[];
}

export interface ModelObject {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
}

export interface ModelsListResponse {
    object: 'list';
    data: ModelObject[];
}

export interface ErrorResponse {
    error: {
        message: string;
        type: string;
        param?: string | null;
        code?: string | null;
    };
}

// Internal types
export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    version: string;
    maxInputTokens: number;
    vendor: string;
}
