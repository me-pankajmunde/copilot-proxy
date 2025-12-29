/**
 * Tool-related type definitions for OpenAI-compatible tool calling
 */

/**
 * Tool function definition
 */
export interface ToolFunction {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
            items?: { type: string };
        }>;
        required?: string[];
    };
}

/**
 * Tool definition
 */
export interface Tool {
    type: 'function';
    function: ToolFunction;
}

/**
 * Tool choice options
 */
export type ToolChoice = 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };

/**
 * Tool call in assistant message
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * Message with tool calls (assistant)
 */
export interface AssistantMessageWithToolCalls {
    role: 'assistant';
    content: string | null;
    tool_calls: ToolCall[];
}

/**
 * Tool result message
 */
export interface ToolResultMessage {
    role: 'tool';
    tool_call_id: string;
    content: string;
}

/**
 * Extended message type supporting tools
 */
export type ChatMessageWithTools = 
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string }
    | AssistantMessageWithToolCalls
    | ToolResultMessage;

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
    /** Unique identifier for this MCP server */
    id: string;
    /** Display name */
    name: string;
    /** Server URL (HTTP/SSE endpoint) */
    url: string;
    /** Optional API key for authentication */
    apiKey?: string;
    /** Whether this server is enabled */
    enabled: boolean;
    /** Tool name prefix to avoid collisions */
    toolPrefix?: string;
}

/**
 * Tool execution configuration
 */
export interface ToolExecutionConfig {
    /** Whether to require approval for tool execution */
    requireApproval: boolean;
    /** Allowed tool names (empty = all allowed) */
    allowlist: string[];
    /** Blocked tool names */
    blocklist: string[];
    /** Timeout for tool execution in ms */
    timeoutMs: number;
    /** Maximum tool calls per request */
    maxToolCalls: number;
}

/**
 * Built-in tool definition
 */
export interface BuiltinToolConfig {
    name: string;
    enabled: boolean;
    config?: Record<string, unknown>;
}

/**
 * Complete tools configuration
 */
export interface ToolsConfig {
    /** Enable tool support */
    enabled: boolean;
    /** Require user approval */
    requireApproval: boolean;
    /** Timeout for tool execution in ms */
    timeoutMs: number;
    /** Maximum tool calls per request */
    maxToolCalls: number;
    /** Enabled built-in tools (empty = all) */
    enabledBuiltins: string[];
    /** MCP server configurations */
    mcpServers: MCPServerConfig[];
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
    success: boolean;
    result?: string;
    error?: string;
    executionTimeMs: number;
}

/**
 * MCP Tool from server
 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/**
 * MCP Server tools response
 */
export interface MCPToolsResponse {
    tools: MCPTool[];
}

/**
 * MCP Tool call request
 */
export interface MCPToolCallRequest {
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * MCP Tool call response
 */
export interface MCPToolCallResponse {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

/**
 * Registered tool with source info
 */
export interface RegisteredTool {
    tool: Tool;
    source: 'builtin' | 'mcp';
    serverId?: string;
    executor: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}
