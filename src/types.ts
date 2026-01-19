/**
 * OpenAI API compatible type definitions
 */

import { Tool, ToolChoice, ToolCall } from './tools/types';

// Request types
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
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
    tools?: Tool[];
    tool_choice?: ToolChoice;
}

// Response types
export interface ChatCompletionChoice {
    index: number;
    message: {
        role: 'assistant';
        content: string | null;
        tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
}

export interface ChatCompletionChunkChoice {
    index: number;
    delta: {
        role?: 'assistant';
        content?: string;
        tool_calls?: Array<{
            index: number;
            id?: string;
            type?: 'function';
            function?: {
                name?: string;
                arguments?: string;
            };
        }>;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
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

// Anthropic API types
export type AnthropicMessageRole = 'user' | 'assistant';

export interface AnthropicTextContent {
    type: 'text';
    text: string;
}

export interface AnthropicMessage {
    role: AnthropicMessageRole;
    content: string | AnthropicTextContent[];
}

export interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    max_tokens: number;
    system?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop_sequences?: string[];
    stream?: boolean;
    metadata?: {
        user_id?: string;
    };
}

export interface AnthropicUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface AnthropicContentBlock {
    type: 'text';
    text: string;
}

export interface AnthropicResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null;
    stop_sequence?: string | null;
    usage: AnthropicUsage;
}

// Anthropic streaming event types
export interface AnthropicMessageStartEvent {
    type: 'message_start';
    message: {
        id: string;
        type: 'message';
        role: 'assistant';
        content: [];
        model: string;
        stop_reason: null;
        stop_sequence: null;
        usage: {
            input_tokens: number;
            output_tokens: number;
        };
    };
}

export interface AnthropicContentBlockStartEvent {
    type: 'content_block_start';
    index: number;
    content_block: {
        type: 'text';
        text: '';
    };
}

export interface AnthropicContentBlockDeltaEvent {
    type: 'content_block_delta';
    index: number;
    delta: {
        type: 'text_delta';
        text: string;
    };
}

export interface AnthropicContentBlockStopEvent {
    type: 'content_block_stop';
    index: number;
}

export interface AnthropicMessageDeltaEvent {
    type: 'message_delta';
    delta: {
        stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
        stop_sequence?: string | null;
    };
    usage: {
        output_tokens: number;
    };
}

export interface AnthropicMessageStopEvent {
    type: 'message_stop';
}

export interface AnthropicPingEvent {
    type: 'ping';
}

export type AnthropicStreamEvent = 
    | AnthropicMessageStartEvent
    | AnthropicContentBlockStartEvent
    | AnthropicContentBlockDeltaEvent
    | AnthropicContentBlockStopEvent
    | AnthropicMessageDeltaEvent
    | AnthropicMessageStopEvent
    | AnthropicPingEvent;
