/**
 * Tool Registry - Manages built-in tools and MCP server connections
 */

import * as vscode from 'vscode';
import { Tool, ToolExecutionResult, MCPServerConfig, ToolsConfig, RegisteredTool, ToolCall } from './types';
import { MCPClient } from './mcp-client';
import { getBuiltinTools, getBuiltinToolNames, BUILTIN_TOOLS } from './builtins';

interface PendingApproval {
    toolCall: ToolCall;
    tool: RegisteredTool;
    resolve: (approved: boolean) => void;
}

export class ToolRegistry {
    private static instance: ToolRegistry;
    private mcpClients: Map<string, MCPClient> = new Map();
    private registeredTools: Map<string, RegisteredTool> = new Map();
    private pendingApprovals: Map<string, PendingApproval> = new Map();
    private config: ToolsConfig;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Copilot Proxy Tools');
        this.config = this.loadConfig();
        this.initializeTools();
    }

    static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
            ToolRegistry.instance = new ToolRegistry();
        }
        return ToolRegistry.instance;
    }

    /**
     * Load configuration from VS Code settings
     */
    private loadConfig(): ToolsConfig {
        const config = vscode.workspace.getConfiguration('copilot-proxy');
        const toolsConfig = config.get<ToolsConfig>('tools');
        
        return {
            enabled: toolsConfig?.enabled ?? true,
            requireApproval: toolsConfig?.requireApproval ?? true,
            maxToolCalls: toolsConfig?.maxToolCalls ?? 5,
            timeoutMs: toolsConfig?.timeoutMs ?? 30000,
            enabledBuiltins: toolsConfig?.enabledBuiltins ?? [],
            mcpServers: toolsConfig?.mcpServers ?? []
        };
    }

    /**
     * Reload configuration and reinitialize
     */
    async reloadConfig(): Promise<void> {
        this.config = this.loadConfig();
        
        // Disconnect all MCP clients
        for (const client of this.mcpClients.values()) {
            await client.disconnect();
        }
        this.mcpClients.clear();
        this.registeredTools.clear();
        
        await this.initializeTools();
        this.log('Configuration reloaded');
    }

    /**
     * Initialize built-in tools and MCP connections
     */
    private async initializeTools(): Promise<void> {
        if (!this.config.enabled) {
            this.log('Tools disabled by configuration');
            return;
        }

        // Register built-in tools
        const builtins = getBuiltinTools(this.config.enabledBuiltins || []);
        for (const tool of builtins) {
            this.registeredTools.set(tool.tool.function.name, tool);
        }
        this.log(`Registered ${builtins.length} built-in tools`);

        // Connect to MCP servers
        if (this.config.mcpServers && this.config.mcpServers.length > 0) {
            for (const serverConfig of this.config.mcpServers) {
                if (serverConfig.enabled !== false) {
                    await this.connectMCPServer(serverConfig);
                }
            }
        }
    }

    /**
     * Connect to an MCP server and register its tools
     */
    async connectMCPServer(serverConfig: MCPServerConfig): Promise<boolean> {
        const id = serverConfig.id || serverConfig.url;
        
        try {
            this.log(`Connecting to MCP server: ${serverConfig.name || id}`);
            
            const client = new MCPClient(serverConfig);
            await client.connect();
            
            const tools = await client.getTools();
            this.mcpClients.set(id, client);
            
            // Register tools with MCP prefix
            for (const registeredTool of tools) {
                this.registeredTools.set(registeredTool.tool.function.name, registeredTool);
            }
            
            this.log(`Connected to MCP server "${serverConfig.name || id}" with ${tools.length} tools`);
            return true;
        } catch (error) {
            this.log(`Failed to connect to MCP server "${id}": ${error}`);
            return false;
        }
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(id: string): Promise<void> {
        const client = this.mcpClients.get(id);
        if (client) {
            await client.disconnect();
            this.mcpClients.delete(id);
            
            // Remove tools from this server
            for (const [name, tool] of this.registeredTools.entries()) {
                if (tool.source === 'mcp' && tool.serverId === id) {
                    this.registeredTools.delete(name);
                }
            }
            
            this.log(`Disconnected from MCP server: ${id}`);
        }
    }

    /**
     * Get all available tools for sending to LLM
     */
    getAvailableTools(): Tool[] {
        if (!this.config.enabled) {
            return [];
        }
        return Array.from(this.registeredTools.values()).map(rt => rt.tool);
    }

    /**
     * Check if tools are enabled
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Execute a tool call
     */
    async executeTool(toolCall: ToolCall): Promise<ToolExecutionResult> {
        const tool = this.registeredTools.get(toolCall.function.name);
        
        if (!tool) {
            return {
                success: false,
                error: `Tool not found: ${toolCall.function.name}`,
                executionTimeMs: 0
            };
        }

        // Parse arguments
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch (error) {
            return {
                success: false,
                error: `Invalid tool arguments: ${error}`,
                executionTimeMs: 0
            };
        }

        // Request approval if required
        if (this.config.requireApproval) {
            const approved = await this.requestApproval(toolCall, tool);
            if (!approved) {
                return {
                    success: false,
                    error: 'Tool execution denied by user',
                    executionTimeMs: 0
                };
            }
        }

        // Execute with timeout
        const timeoutMs = this.config.timeoutMs || 30000;
        const startTime = Date.now();
        
        try {
            this.log(`Executing tool: ${toolCall.function.name}`);
            
            const result = await Promise.race([
                tool.executor(args),
                new Promise<ToolExecutionResult>((_, reject) => 
                    setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
                )
            ]);
            
            this.log(`Tool ${toolCall.function.name} completed: ${result.success ? 'success' : 'failed'}`);
            return result;
        } catch (error) {
            this.log(`Tool ${toolCall.function.name} error: ${error}`);
            return {
                success: false,
                error: `Tool execution failed: ${error instanceof Error ? error.message : error}`,
                executionTimeMs: Date.now() - startTime
            };
        }
    }

    /**
     * Execute multiple tool calls
     */
    async executeToolCalls(toolCalls: ToolCall[]): Promise<Map<string, ToolExecutionResult>> {
        const results = new Map<string, ToolExecutionResult>();
        const maxCalls = this.config.maxToolCalls || 5;
        
        // Limit number of tool calls
        const callsToExecute = toolCalls.slice(0, maxCalls);
        if (toolCalls.length > maxCalls) {
            this.log(`Warning: Limiting tool calls from ${toolCalls.length} to ${maxCalls}`);
        }

        // Execute sequentially to allow for user approval
        for (const call of callsToExecute) {
            const result = await this.executeTool(call);
            results.set(call.id, result);
        }

        return results;
    }

    /**
     * Request user approval for tool execution
     */
    private async requestApproval(toolCall: ToolCall, tool: RegisteredTool): Promise<boolean> {
        return new Promise(async (resolve) => {
            const args = JSON.parse(toolCall.function.arguments);
            const argsDisplay = Object.entries(args)
                .map(([k, v]) => `  ${k}: ${JSON.stringify(v).substring(0, 50)}`)
                .join('\n');

            const message = `Allow tool execution?\n\nTool: ${toolCall.function.name}\nSource: ${tool.source}${tool.serverId ? ` (${tool.serverId})` : ''}\nArguments:\n${argsDisplay}`;

            const choice = await vscode.window.showInformationMessage(
                message,
                { modal: true },
                'Allow',
                'Allow All',
                'Deny'
            );

            if (choice === 'Allow All') {
                // Temporarily disable approval for this session
                this.config.requireApproval = false;
                vscode.window.showInformationMessage('Tool approval disabled for this session');
                resolve(true);
            } else {
                resolve(choice === 'Allow');
            }
        });
    }

    /**
     * Get tool by name
     */
    getTool(name: string): RegisteredTool | undefined {
        return this.registeredTools.get(name);
    }

    /**
     * Get current configuration
     */
    getConfig(): ToolsConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<ToolsConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    /**
     * Get status information
     */
    getStatus(): {
        enabled: boolean;
        toolCount: number;
        builtinCount: number;
        mcpServerCount: number;
        mcpServers: Array<{ id: string; connected: boolean; toolCount: number }>;
    } {
        const builtinCount = Array.from(this.registeredTools.values())
            .filter(t => t.source === 'builtin').length;
        
        const mcpServers = Array.from(this.mcpClients.entries()).map(([id, client]) => ({
            id,
            connected: true,
            toolCount: Array.from(this.registeredTools.values())
                .filter(t => t.serverId === id).length
        }));

        return {
            enabled: this.config.enabled,
            toolCount: this.registeredTools.size,
            builtinCount,
            mcpServerCount: this.mcpClients.size,
            mcpServers
        };
    }

    /**
     * Log to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Show output channel
     */
    showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose resources
     */
    async dispose(): Promise<void> {
        for (const client of this.mcpClients.values()) {
            await client.disconnect();
        }
        this.mcpClients.clear();
        this.registeredTools.clear();
        this.outputChannel.dispose();
    }
}

/**
 * Get the singleton registry instance
 */
export function getToolRegistry(): ToolRegistry {
    return ToolRegistry.getInstance();
}
