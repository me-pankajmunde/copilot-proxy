/**
 * MCP Client - connects to MCP servers via HTTP
 */

import { MCPServerConfig, Tool, ToolExecutionResult, MCPTool, RegisteredTool } from './types';

export class MCPClient {
    private config: MCPServerConfig;
    private tools: Tool[] = [];
    private connected: boolean = false;

    constructor(config: MCPServerConfig) {
        this.config = config;
    }

    get id(): string { return this.config.id || this.config.url; }
    get name(): string { return this.config.name || this.config.url; }
    get enabled(): boolean { return this.config.enabled !== false; }
    get isConnected(): boolean { return this.connected; }

    async connect(): Promise<void> {
        if (!this.config.enabled) {
            console.log(`[MCP Client] ${this.config.name} is disabled`);
            return;
        }

        try {
            // Fetch tools from MCP server using the standard MCP HTTP protocol
            const response = await fetch(`${this.config.url}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                    params: {}
                }),
                signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as { result?: { tools: MCPTool[] }; error?: { message: string } };
            
            if (data.error) {
                throw new Error(data.error.message);
            }

            const mcpTools = data.result?.tools || [];
            
            // Convert MCP tools to OpenAI tool format
            this.tools = mcpTools.map(t => this.convertMCPTool(t));
            this.connected = true;

            console.log(`[MCP Client] Connected to ${this.config.name}, found ${this.tools.length} tools:`,
                this.tools.map(t => t.function.name).join(', '));
        } catch (err) {
            console.error(`[MCP Client] Failed to connect to ${this.config.name}:`, err);
            this.tools = [];
            this.connected = false;
        }
    }

    /**
     * Convert MCP tool to OpenAI tool format
     */
    private convertMCPTool(mcpTool: MCPTool): Tool {
        const name = this.config.toolPrefix 
            ? `${this.config.toolPrefix}_${mcpTool.name}` 
            : mcpTool.name;

        return {
            type: 'function',
            function: {
                name,
                description: mcpTool.description,
                parameters: mcpTool.inputSchema as Tool['function']['parameters']
            }
        };
    }

    /**
     * Get the actual tool name (without prefix) for MCP server
     */
    private getActualToolName(name: string): string {
        if (this.config.toolPrefix && name.startsWith(`${this.config.toolPrefix}_`)) {
            return name.slice(this.config.toolPrefix.length + 1);
        }
        return name;
    }

    /**
     * Get tools as RegisteredTool array with executors
     */
    getTools(): RegisteredTool[] {
        const serverId = this.id;
        return this.tools.map(tool => ({
            tool,
            source: 'mcp' as const,
            serverId,
            executor: (args: Record<string, unknown>) => this.callTool(tool.function.name, args)
        }));
    }

    hasToolName(name: string): boolean {
        return this.tools.some(t => t.function.name === name);
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
        const startTime = Date.now();
        const actualName = this.getActualToolName(name);

        try {
            const response = await fetch(`${this.config.url}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: {
                        name: actualName,
                        arguments: args
                    }
                }),
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as { 
                result?: { content: Array<{ type: string; text?: string }>; isError?: boolean };
                error?: { message: string };
            };

            if (data.error) {
                return {
                    success: false,
                    error: data.error.message,
                    executionTimeMs: Date.now() - startTime
                };
            }

            // Format result for LLM consumption - clean markdown format
            const content = data.result?.content || [];
            const textParts = content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text);

            const formattedResult = textParts.length > 0 
                ? textParts.join('\n\n')
                : 'Tool executed successfully (no output)';

            return {
                success: !data.result?.isError,
                result: formattedResult,
                executionTimeMs: Date.now() - startTime
            };
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Unknown error calling MCP tool',
                executionTimeMs: Date.now() - startTime
            };
        }
    }

    disconnect(): void {
        this.tools = [];
        this.connected = false;
        console.log(`[MCP Client] Disconnected from ${this.name}`);
    }
}
