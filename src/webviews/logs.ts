/**
 * Logs Webview Panel - displays request/response logs in VS Code
 */

import * as vscode from 'vscode';
import { getLoggingService } from '../logging';
import { getCacheService } from '../cache';
import { RequestLogEntry } from '../providers/types';

export class LogsWebviewPanel {
    public static currentPanel: LogsWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.html = this._getHtmlContent();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for new logs
        const loggingService = getLoggingService();
        loggingService.onLogAdded(() => {
            this._updateLogs();
        });
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (LogsWebviewPanel.currentPanel) {
            LogsWebviewPanel.currentPanel._panel.reveal(column);
            LogsWebviewPanel.currentPanel._updateLogs();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'copilotProxyLogs',
            'Copilot Proxy Logs',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        LogsWebviewPanel.currentPanel = new LogsWebviewPanel(panel, extensionUri);
    }

    private _updateLogs() {
        const logs = getLoggingService().getRecentLogs(100);
        const stats = getLoggingService().getStats();
        const cacheStats = getCacheService().getStats();

        this._panel.webview.postMessage({
            type: 'updateLogs',
            logs: logs.map(log => ({
                ...log,
                timestamp: log.timestamp.toISOString()
            })),
            stats,
            cacheStats
        });
    }

    private _handleMessage(message: { command: string; logId?: string }) {
        switch (message.command) {
            case 'refresh':
                this._updateLogs();
                break;
            case 'clearLogs':
                getLoggingService().clearLogs();
                this._updateLogs();
                break;
            case 'clearCache':
                getCacheService().clear();
                this._updateLogs();
                break;
            case 'toggleCache':
                const cache = getCacheService();
                cache.setEnabled(!cache.enabled);
                this._updateLogs();
                break;
            case 'exportJson':
                this._exportLogs('json');
                break;
            case 'exportCsv':
                this._exportLogs('csv');
                break;
            case 'copyLog':
                if (message.logId) {
                    const logs = getLoggingService().getLogs();
                    const log = logs.find(l => l.id === message.logId);
                    if (log) {
                        vscode.env.clipboard.writeText(JSON.stringify(log, null, 2));
                        vscode.window.showInformationMessage('Log copied to clipboard');
                    }
                }
                break;
        }
    }

    private async _exportLogs(format: 'json' | 'csv') {
        const loggingService = getLoggingService();
        const content = format === 'json' 
            ? loggingService.exportAsJson() 
            : loggingService.exportAsCsv();
        
        const uri = await vscode.window.showSaveDialog({
            filters: format === 'json' 
                ? { 'JSON': ['json'] } 
                : { 'CSV': ['csv'] },
            defaultUri: vscode.Uri.file(`copilot-proxy-logs.${format}`)
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
            vscode.window.showInformationMessage(`Logs exported to ${uri.fsPath}`);
        }
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copilot Proxy Logs</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 16px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 8px;
        }
        .stats {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }
        .stat {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .logs {
            margin-top: 16px;
        }
        .log-entry {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
        }
        .log-entry:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .log-model {
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .log-meta {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .log-content {
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 150px;
            overflow: hidden;
        }
        .log-entry.expanded .log-content {
            max-height: none;
        }
        .status-success { color: var(--vscode-testing-iconPassed); }
        .status-error { color: var(--vscode-testing-iconFailed); }
        .status-cached { color: var(--vscode-charts-yellow); }
        .empty {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .filters {
            margin-bottom: 16px;
            display: flex;
            gap: 8px;
        }
        input, select {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>📊 Request Logs</h2>
        <div class="stats" id="stats"></div>
    </div>
    
    <div class="actions">
        <button onclick="refresh()">🔄 Refresh</button>
        <button onclick="clearLogs()" class="secondary">🗑️ Clear Logs</button>
        <button onclick="toggleCache()" id="cacheToggle">💾 Toggle Cache</button>
        <button onclick="clearCache()" class="secondary">🧹 Clear Cache</button>
        <button onclick="exportJson()" class="secondary">📥 Export JSON</button>
        <button onclick="exportCsv()" class="secondary">📥 Export CSV</button>
    </div>

    <div class="filters">
        <input type="text" id="filterText" placeholder="Filter by model or provider..." oninput="filterLogs()">
        <select id="filterStatus" onchange="filterLogs()">
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="cached">Cached</option>
        </select>
    </div>

    <div class="logs" id="logs">
        <div class="empty">No logs yet. Make some API requests to see them here.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let allLogs = [];

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function clearLogs() {
            vscode.postMessage({ command: 'clearLogs' });
        }

        function clearCache() {
            vscode.postMessage({ command: 'clearCache' });
        }

        function toggleCache() {
            vscode.postMessage({ command: 'toggleCache' });
        }

        function exportJson() {
            vscode.postMessage({ command: 'exportJson' });
        }

        function exportCsv() {
            vscode.postMessage({ command: 'exportCsv' });
        }

        function copyLog(logId) {
            vscode.postMessage({ command: 'copyLog', logId });
        }

        function toggleExpand(element) {
            element.classList.toggle('expanded');
        }

        function filterLogs() {
            const text = document.getElementById('filterText').value.toLowerCase();
            const status = document.getElementById('filterStatus').value;
            
            const filtered = allLogs.filter(log => {
                const matchesText = !text || 
                    log.model.toLowerCase().includes(text) || 
                    log.provider.toLowerCase().includes(text);
                
                const matchesStatus = !status ||
                    (status === 'success' && !log.error && !log.cached) ||
                    (status === 'error' && log.error) ||
                    (status === 'cached' && log.cached);
                
                return matchesText && matchesStatus;
            });
            
            renderLogs(filtered);
        }

        function renderLogs(logs) {
            const container = document.getElementById('logs');
            
            if (logs.length === 0) {
                container.innerHTML = '<div class="empty">No logs match the current filter.</div>';
                return;
            }

            container.innerHTML = logs.map(log => {
                const statusClass = log.error ? 'status-error' : (log.cached ? 'status-cached' : 'status-success');
                const statusIcon = log.error ? '❌' : (log.cached ? '💾' : '✓');
                const lastMessage = log.messages[log.messages.length - 1]?.content || '';
                const preview = lastMessage.length > 200 ? lastMessage.substring(0, 200) + '...' : lastMessage;
                
                return \`
                    <div class="log-entry" onclick="toggleExpand(this)">
                        <div class="log-header">
                            <span class="log-model">
                                <span class="\${statusClass}">\${statusIcon}</span>
                                \${log.provider}/\${log.model}
                            </span>
                            <span class="log-meta">
                                \${log.latencyMs}ms | \${new Date(log.timestamp).toLocaleTimeString()}
                                <button onclick="event.stopPropagation(); copyLog('\${log.id}')" style="margin-left: 8px; padding: 2px 6px;">📋</button>
                            </span>
                        </div>
                        <div class="log-content">
                            <strong>Input:</strong> \${escapeHtml(preview)}
                            \${log.response ? '<br><br><strong>Output:</strong> ' + escapeHtml(log.response.substring(0, 500)) + (log.response.length > 500 ? '...' : '') : ''}
                            \${log.error ? '<br><br><strong style="color: var(--vscode-testing-iconFailed);">Error:</strong> ' + escapeHtml(log.error) : ''}
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function updateStats(stats, cacheStats) {
            document.getElementById('stats').innerHTML = \`
                <span class="stat">Total: \${stats.totalRequests}</span>
                <span class="stat status-success">Success: \${stats.successfulRequests}</span>
                <span class="stat status-error">Failed: \${stats.failedRequests}</span>
                <span class="stat status-cached">Cached: \${stats.cachedRequests}</span>
                <span class="stat">Avg: \${stats.averageLatencyMs}ms</span>
                <span class="stat">Cache: \${cacheStats.size} entries (\${cacheStats.enabled ? 'ON' : 'OFF'})</span>
            \`;
            
            document.getElementById('cacheToggle').textContent = cacheStats.enabled ? '💾 Disable Cache' : '💾 Enable Cache';
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateLogs') {
                allLogs = message.logs;
                updateStats(message.stats, message.cacheStats);
                filterLogs();
            }
        });

        // Initial load
        refresh();
    </script>
</body>
</html>`;
    }

    public dispose() {
        LogsWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
