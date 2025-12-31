import * as vscode from 'vscode';
import { ProxyServer } from './server';
import {
    getProviderRegistry,
    disposeProviderRegistry,
    loadProvidersConfig,
    CopilotProvider,
    OpenAIProvider,
    OllamaProvider,
    AzureOpenAIProvider
} from './providers';
import { getLoggingService, disposeLoggingService } from './logging';
import { getCacheService, disposeCacheService } from './cache';
import { getToolRegistry } from './tools/registry';
import { LogsWebviewPanel } from './webviews/logs';

let proxyServer: ProxyServer | null = null;

/**
 * Initialize all configured providers
 */
async function initializeProviders(): Promise<void> {
    const registry = getProviderRegistry();
    const config = loadProvidersConfig();

    // Always register Copilot provider
    const copilotConfig = config.copilot ?? { enabled: true };
    registry.registerProvider(new CopilotProvider(copilotConfig));

    // Register OpenAI provider if configured
    if (config.openai) {
        registry.registerProvider(new OpenAIProvider(config.openai));
    }

    // Register Ollama provider if configured
    if (config.ollama) {
        registry.registerProvider(new OllamaProvider(config.ollama));
    }

    // Register Azure OpenAI provider if configured
    if (config['azure-openai']) {
        registry.registerProvider(new AzureOpenAIProvider(config['azure-openai']));
    }

    // Initialize all providers
    await registry.initialize();
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('[Copilot Proxy] Extension activating...');

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(radio-tower) Copilot Proxy: Stopped';
    statusBarItem.tooltip = 'Click to start the Copilot OpenAI Proxy server';
    statusBarItem.command = 'copilot-proxy.start';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initialize the proxy server
    proxyServer = new ProxyServer(statusBarItem);

    // Initialize provider registry
    const registry = getProviderRegistry();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-proxy.start', async () => {
            if (proxyServer?.isRunning()) {
                vscode.window.showInformationMessage(
                    `Copilot Proxy is already running on port ${proxyServer.getPort()}`
                );
                return;
            }

            try {
                // Initialize providers (requires user consent for Copilot)
                await initializeProviders();

                if (!registry.hasModels()) {
                    const result = await vscode.window.showWarningMessage(
                        'No models available. Make sure at least one provider is configured.',
                        'Retry',
                        'Start Anyway'
                    );

                    if (result === 'Retry') {
                        await registry.refreshModelCache();
                        if (!registry.hasModels()) {
                            vscode.window.showErrorMessage('Still no models available.');
                            return;
                        }
                    } else if (result !== 'Start Anyway') {
                        return;
                    }
                }

                await proxyServer?.start();

                const port = proxyServer?.getPort();
                const token = proxyServer?.getToken();

                // Configure automatic port forwarding if enabled
                const autoForward = config.get<boolean>('autoForwardPort', false);
                const visibility = config.get<'private' | 'public'>('portVisibility', 'private');

                if (autoForward) {
                    try {
                        await proxyServer?.configurePortForwarding(visibility);
                        
                        const message = visibility === 'public' 
                            ? `Server started on port ${port}. Port forwarding configured (public access).`
                            : `Server started on port ${port}. Port forwarding configured.`;
                        
                        const action = await vscode.window.showInformationMessage(
                            message,
                            'Copy Token',
                            'Open Ports View',
                            'Show Models'
                        );
                        
                        if (action === 'Copy Token') {
                            await vscode.env.clipboard.writeText(token || '');
                            vscode.window.showInformationMessage('API token copied to clipboard');
                        } else if (action === 'Open Ports View') {
                            vscode.commands.executeCommand('workbench.view.remote');
                        } else if (action === 'Show Models') {
                            vscode.commands.executeCommand('copilot-proxy.showModels');
                        }
                    } catch (err) {
                        vscode.window.showWarningMessage(
                            `Server started but port forwarding failed: ${err instanceof Error ? err.message : 'Unknown error'}`
                        );
                    }
                } else {
                    // Show success message with actions
                    const action = await vscode.window.showInformationMessage(
                        `Copilot Proxy started on http://127.0.0.1:${port}`,
                        'Copy Token',
                        'Copy Base URL',
                        'Setup Port Forwarding',
                        'Show Models'
                    );

                    if (action === 'Copy Token') {
                        await vscode.env.clipboard.writeText(token || '');
                        vscode.window.showInformationMessage('API token copied to clipboard');
                    } else if (action === 'Copy Base URL') {
                        await vscode.env.clipboard.writeText(`http://127.0.0.1:${port}/v1`);
                        vscode.window.showInformationMessage('Base URL copied to clipboard');
                    } else if (action === 'Setup Port Forwarding') {
                        vscode.commands.executeCommand('copilot-proxy.setupPortForwarding');
                    } else if (action === 'Show Models') {
                        vscode.commands.executeCommand('copilot-proxy.showModels');
                    }
                }

            } catch (err) {
                vscode.window.showErrorMessage(
                    `Failed to start Copilot Proxy: ${err instanceof Error ? err.message : 'Unknown error'}`
                );
            }
        }),

        vscode.commands.registerCommand('copilot-proxy.stop', async () => {
            if (!proxyServer?.isRunning()) {
                vscode.window.showInformationMessage('Copilot Proxy is not running');
                return;
            }

            await proxyServer.stop();
            vscode.window.showInformationMessage('Copilot Proxy stopped');
        }),

        vscode.commands.registerCommand('copilot-proxy.copyToken', async () => {
            if (!proxyServer?.isRunning()) {
                vscode.window.showWarningMessage('Copilot Proxy is not running. Start it first.');
                return;
            }

            const token = proxyServer.getToken();
            await vscode.env.clipboard.writeText(token);
            vscode.window.showInformationMessage('API token copied to clipboard');
        }),

        vscode.commands.registerCommand('copilot-proxy.showModels', async () => {
            const models = await registry.getAllModels();

            if (models.length === 0) {
                vscode.window.showWarningMessage('No models available. Check provider configuration.');
                return;
            }

            const items = models.map(model => ({
                label: model.name,
                description: model.fullId,
                detail: `Provider: ${model.providerId}${model.maxInputTokens ? ` | Max tokens: ${model.maxInputTokens}` : ''}`
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Available Models',
                title: 'Copilot OpenAI Proxy - Available Models'
            });

            if (selected) {
                await vscode.env.clipboard.writeText(selected.description || selected.label);
                vscode.window.showInformationMessage(`Model ID "${selected.description || selected.label}" copied to clipboard`);
            }
        }),

        vscode.commands.registerCommand('copilot-proxy.showLogs', async () => {
            LogsWebviewPanel.createOrShow(context.extensionUri);
        }),

        vscode.commands.registerCommand('copilot-proxy.showStats', async () => {
            const logStats = getLoggingService().getStats();
            const cacheStats = getCacheService().getStats();

            const message = [
                `📊 Request Statistics`,
                `Total: ${logStats.totalRequests} | Success: ${logStats.successfulRequests} | Failed: ${logStats.failedRequests}`,
                `Cached: ${logStats.cachedRequests} | Avg Latency: ${logStats.averageLatencyMs}ms`,
                ``,
                `💾 Cache: ${cacheStats.size} entries | ${cacheStats.enabled ? 'Enabled' : 'Disabled'}`
            ].join('\n');

            vscode.window.showInformationMessage(message, { modal: true });
        }),

        vscode.commands.registerCommand('copilot-proxy.clearCache', async () => {
            getCacheService().clear();
            vscode.window.showInformationMessage('Cache cleared');
        }),

        vscode.commands.registerCommand('copilot-proxy.toggleCache', async () => {
            const cache = getCacheService();
            cache.setEnabled(!cache.enabled);
            vscode.window.showInformationMessage(`Cache ${cache.enabled ? 'enabled' : 'disabled'}`);
        }),

        vscode.commands.registerCommand('copilot-proxy.showTools', async () => {
            const toolRegistry = getToolRegistry();
            const status = toolRegistry.getStatus();
            const tools = toolRegistry.getAvailableTools();

            if (tools.length === 0) {
                vscode.window.showWarningMessage('No tools available. Check tools configuration.');
                return;
            }

            const items = tools.map(tool => ({
                label: tool.function.name,
                description: tool.function.description?.substring(0, 60) + (tool.function.description && tool.function.description.length > 60 ? '...' : ''),
                detail: `Parameters: ${Object.keys(tool.function.parameters?.properties || {}).join(', ') || 'none'}`
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${status.builtinCount} built-in, ${status.mcpServerCount} MCP servers`,
                title: `Copilot Proxy - Available Tools (${tools.length})`
            });

            if (selected) {
                const tool = tools.find(t => t.function.name === selected.label);
                if (tool) {
                    const toolInfo = JSON.stringify(tool, null, 2);
                    const doc = await vscode.workspace.openTextDocument({
                        content: toolInfo,
                        language: 'json'
                    });
                    await vscode.window.showTextDocument(doc);
                }
            }
        }),

        vscode.commands.registerCommand('copilot-proxy.reloadTools', async () => {
            const toolRegistry = getToolRegistry();
            await toolRegistry.reloadConfig();
            const status = toolRegistry.getStatus();
            vscode.window.showInformationMessage(
                `Tools reloaded: ${status.toolCount} tools from ${status.builtinCount} built-ins and ${status.mcpServerCount} MCP servers`
            );
        }),

        vscode.commands.registerCommand('copilot-proxy.setupPortForwarding', async () => {
            if (!proxyServer?.isRunning()) {
                vscode.window.showWarningMessage('Server is not running. Start it first.');
                return;
            }
            
            const visibility = await vscode.window.showQuickPick(
                [
                    { label: 'Private', description: 'Only accessible from this machine', value: 'private' },
                    { label: 'Public', description: 'Accessible via GitHub forwarded URL', value: 'public' }
                ],
                { placeHolder: 'Select port visibility' }
            );
            
            if (visibility) {
                try {
                    await proxyServer.configurePortForwarding(visibility.value as 'private' | 'public');
                    vscode.window.showInformationMessage(
                        `Port forwarding configured (${visibility.label})! Open the PORTS view to see the forwarded URL.`,
                        'Open Ports View'
                    ).then(action => {
                        if (action === 'Open Ports View') {
                            vscode.commands.executeCommand('workbench.view.remote');
                        }
                    });
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `Failed to setup port forwarding: ${err instanceof Error ? err.message : 'Unknown error'}`
                    );
                }
            }
        })
    );

    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('copilot-proxy');
    if (config.get<boolean>('autoStart', false)) {
        // Delay auto-start to ensure VS Code is fully loaded
        setTimeout(() => {
            vscode.commands.executeCommand('copilot-proxy.start');
        }, 3000);
    }

    console.log('[Copilot Proxy] Extension activated');
}

export async function deactivate() {
    console.log('[Copilot Proxy] Extension deactivating...');
    
    if (proxyServer) {
        proxyServer.dispose();
        proxyServer = null;
    }
    
    // Dispose tool registry
    await getToolRegistry().dispose();
    
    disposeProviderRegistry();
    disposeLoggingService();
    disposeCacheService();
    
    console.log('[Copilot Proxy] Extension deactivated');
}
