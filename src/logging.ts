/**
 * Request/Response Logging System
 */

import * as vscode from 'vscode';
import { OpenAIMessage } from './types';
import { CompletionOptions, RequestLogEntry } from './providers/types';

const MAX_LOG_ENTRIES = 1000;

class LoggingService {
    private logs: RequestLogEntry[] = [];
    private _onLogAdded = new vscode.EventEmitter<RequestLogEntry>();
    
    readonly onLogAdded = this._onLogAdded.event;

    constructor() {}

    /**
     * Add a log entry
     */
    addLog(entry: RequestLogEntry): void {
        this.logs.unshift(entry); // Add to beginning for newest first
        
        // Trim if exceeds max
        if (this.logs.length > MAX_LOG_ENTRIES) {
            this.logs = this.logs.slice(0, MAX_LOG_ENTRIES);
        }

        this._onLogAdded.fire(entry);
        
        // Also log to console for debugging
        const status = entry.error ? '❌' : '✓';
        console.log(
            `[Request Log] ${status} ${entry.provider}/${entry.model} - ${entry.latencyMs}ms` +
            (entry.cached ? ' (cached)' : '')
        );
    }

    /**
     * Create a new log entry and return a function to complete it
     */
    startLog(
        provider: string,
        model: string,
        messages: OpenAIMessage[],
        options: CompletionOptions,
        streaming: boolean
    ): { id: string; complete: (response?: string, error?: string, cached?: boolean) => void } {
        const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const startTime = Date.now();

        return {
            id,
            complete: (response?: string, error?: string, cached: boolean = false) => {
                const entry: RequestLogEntry = {
                    id,
                    timestamp: new Date(),
                    provider,
                    model,
                    messages,
                    options,
                    response,
                    error,
                    latencyMs: Date.now() - startTime,
                    streaming,
                    cached
                };
                this.addLog(entry);
            }
        };
    }

    /**
     * Get all logs
     */
    getLogs(): RequestLogEntry[] {
        return [...this.logs];
    }

    /**
     * Get logs filtered by provider
     */
    getLogsByProvider(provider: string): RequestLogEntry[] {
        return this.logs.filter(l => l.provider === provider);
    }

    /**
     * Get logs filtered by model
     */
    getLogsByModel(model: string): RequestLogEntry[] {
        return this.logs.filter(l => l.model === model || l.model.includes(model));
    }

    /**
     * Get recent logs
     */
    getRecentLogs(count: number = 50): RequestLogEntry[] {
        return this.logs.slice(0, count);
    }

    /**
     * Clear all logs
     */
    clearLogs(): void {
        this.logs = [];
    }

    /**
     * Export logs as JSON
     */
    exportAsJson(): string {
        return JSON.stringify(this.logs, null, 2);
    }

    /**
     * Export logs as CSV
     */
    exportAsCsv(): string {
        const headers = ['id', 'timestamp', 'provider', 'model', 'latencyMs', 'streaming', 'cached', 'error'];
        const rows = this.logs.map(log => [
            log.id,
            log.timestamp.toISOString(),
            log.provider,
            log.model,
            log.latencyMs.toString(),
            log.streaming.toString(),
            log.cached.toString(),
            log.error || ''
        ]);
        
        return [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        ].join('\n');
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        cachedRequests: number;
        averageLatencyMs: number;
        requestsByProvider: { [provider: string]: number };
        requestsByModel: { [model: string]: number };
    } {
        const stats = {
            totalRequests: this.logs.length,
            successfulRequests: 0,
            failedRequests: 0,
            cachedRequests: 0,
            averageLatencyMs: 0,
            requestsByProvider: {} as { [provider: string]: number },
            requestsByModel: {} as { [model: string]: number }
        };

        let totalLatency = 0;

        for (const log of this.logs) {
            if (log.error) {
                stats.failedRequests++;
            } else {
                stats.successfulRequests++;
            }

            if (log.cached) {
                stats.cachedRequests++;
            }

            totalLatency += log.latencyMs;

            stats.requestsByProvider[log.provider] = (stats.requestsByProvider[log.provider] || 0) + 1;
            stats.requestsByModel[log.model] = (stats.requestsByModel[log.model] || 0) + 1;
        }

        stats.averageLatencyMs = this.logs.length > 0 ? Math.round(totalLatency / this.logs.length) : 0;

        return stats;
    }

    dispose(): void {
        this._onLogAdded.dispose();
    }
}

// Singleton instance
let loggingServiceInstance: LoggingService | null = null;

export function getLoggingService(): LoggingService {
    if (!loggingServiceInstance) {
        loggingServiceInstance = new LoggingService();
    }
    return loggingServiceInstance;
}

export function disposeLoggingService(): void {
    if (loggingServiceInstance) {
        loggingServiceInstance.dispose();
        loggingServiceInstance = null;
    }
}
