import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { handleListModels, handleGetModel } from './handlers/models';
import { handleChatCompletions } from './handlers/completions';
import { handleCompare, handleListProviders } from './handlers/compare';
import { getLoggingService } from './logging';
import { getCacheService } from './cache';

/**
 * HTTP Server for OpenAI-compatible API
 */
export class ProxyServer {
    private server: http.Server | null = null;
    private authToken: string = '';
    private port: number = 5001;
    private statusBarItem: vscode.StatusBarItem;

    constructor(statusBarItem: vscode.StatusBarItem) {
        this.statusBarItem = statusBarItem;
        this.generateToken();
    }

    /**
     * Generate a new authentication token
     */
    private generateToken(): void {
        this.authToken = crypto.randomBytes(32).toString('hex');
    }

    /**
     * Get the current authentication token
     */
    getToken(): string {
        return this.authToken;
    }

    /**
     * Get the current port
     */
    getPort(): number {
        return this.port;
    }

    /**
     * Check if the server is running
     */
    isRunning(): boolean {
        return this.server !== null;
    }

    /**
     * Validate the Authorization header
     */
    private validateAuth(req: http.IncomingMessage): boolean {
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return false;
        }

        const token = authHeader.replace(/^Bearer\s+/i, '');
        return token === this.authToken;
    }

    /**
     * Send an error response
     */
    private sendError(
        res: http.ServerResponse,
        statusCode: number,
        message: string,
        type: string = 'error'
    ): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message,
                type
            }
        }));
    }

    /**
     * Handle incoming requests
     */
    private async handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        // Set CORS headers for local development
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Parse URL
        const url = new URL(req.url || '/', `http://localhost:${this.port}`);
        const pathname = url.pathname;

        // Validate authentication (except for health check)
        if (pathname !== '/health' && !this.validateAuth(req)) {
            this.sendError(res, 401, 'Invalid or missing authentication token', 'authentication_error');
            return;
        }

        try {
            // Route requests
            if (pathname === '/health' && req.method === 'GET') {
                // Health check endpoint (no auth required)
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } else if (pathname === '/v1/models' && req.method === 'GET') {
                await handleListModels(req, res);
            } else if (pathname.match(/^\/v1\/models\/[\w\-\/]+$/) && req.method === 'GET') {
                // Support model IDs with provider prefix: /v1/models/copilot/gpt-4o
                const modelId = pathname.replace('/v1/models/', '');
                await handleGetModel(req, res, modelId);
            } else if (pathname === '/v1/chat/completions' && req.method === 'POST') {
                await handleChatCompletions(req, res);
            } else if (pathname === '/v1/chat/completions/compare' && req.method === 'POST') {
                await handleCompare(req, res);
            } else if (pathname === '/v1/providers' && req.method === 'GET') {
                await handleListProviders(req, res);
            } else if (pathname === '/v1/logs' && req.method === 'GET') {
                const logs = getLoggingService().getRecentLogs(100);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ object: 'list', data: logs }, null, 2));
            } else if (pathname === '/v1/logs/stats' && req.method === 'GET') {
                const stats = getLoggingService().getStats();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(stats, null, 2));
            } else if (pathname === '/v1/cache/stats' && req.method === 'GET') {
                const stats = getCacheService().getStats();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(stats, null, 2));
            } else if (pathname === '/v1/cache/clear' && req.method === 'POST') {
                getCacheService().clear();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', message: 'Cache cleared' }));
            } else {
                this.sendError(res, 404, `Endpoint not found: ${req.method} ${pathname}`, 'invalid_request_error');
            }
        } catch (err) {
            console.error('[Copilot Proxy] Request error:', err);
            this.sendError(res, 500, err instanceof Error ? err.message : 'Internal server error', 'server_error');
        }
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        if (this.server) {
            throw new Error('Server is already running');
        }

        // Get port from configuration
        const config = vscode.workspace.getConfiguration('copilot-proxy');
        this.port = config.get<number>('port', 5001);

        // Generate a new token on each start
        this.generateToken();

        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(err => {
                    console.error('[Copilot Proxy] Unhandled error:', err);
                    if (!res.headersSent) {
                        this.sendError(res, 500, 'Internal server error', 'server_error');
                    }
                });
            });

            this.server.on('error', (err: NodeJS.ErrnoException) => {
                this.server = null;
                this.updateStatusBar();
                
                if (err.code === 'EADDRINUSE') {
                    reject(new Error(`Port ${this.port} is already in use. Change the port in settings.`));
                } else {
                    reject(err);
                }
            });

            // Bind to localhost only for security
            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`[Copilot Proxy] Server started on http://127.0.0.1:${this.port}`);
                this.updateStatusBar();
                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    this.updateStatusBar();
                    console.log('[Copilot Proxy] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Update the status bar item
     */
    private updateStatusBar(): void {
        if (this.server) {
            this.statusBarItem.text = `$(radio-tower) Copilot Proxy: ${this.port}`;
            this.statusBarItem.tooltip = `Copilot OpenAI Proxy running on http://127.0.0.1:${this.port}\nClick to copy API token`;
            this.statusBarItem.command = 'copilot-proxy.copyToken';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.text = '$(radio-tower) Copilot Proxy: Stopped';
            this.statusBarItem.tooltip = 'Click to start the Copilot OpenAI Proxy server';
            this.statusBarItem.command = 'copilot-proxy.start';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
