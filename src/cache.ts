/**
 * Response Cache System
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { OpenAIMessage } from './types';
import { CompletionOptions } from './providers/types';

interface CacheEntry {
    response: string;
    timestamp: number;
    model: string;
    provider: string;
}

const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_CACHE_SIZE = 500;

class CacheService {
    private cache: Map<string, CacheEntry> = new Map();
    private _enabled: boolean = false;
    private cacheTtlMs: number = DEFAULT_CACHE_TTL_MS;

    constructor() {
        this.loadConfig();
    }

    private loadConfig(): void {
        const config = vscode.workspace.getConfiguration('copilot-proxy');
        this._enabled = config.get<boolean>('cacheEnabled', false);
        this.cacheTtlMs = config.get<number>('cacheTtlMinutes', 60) * 60 * 1000;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    /**
     * Generate a cache key from request parameters
     */
    private generateKey(
        provider: string,
        model: string,
        messages: OpenAIMessage[],
        options: CompletionOptions
    ): string {
        const data = JSON.stringify({
            provider,
            model,
            messages,
            // Only include options that affect output
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            topP: options.topP,
            stop: options.stop
        });
        
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Get cached response if available and not expired
     */
    get(
        provider: string,
        model: string,
        messages: OpenAIMessage[],
        options: CompletionOptions
    ): string | null {
        if (!this._enabled) {
            return null;
        }

        const key = this.generateKey(provider, model, messages, options);
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // Check if expired
        if (Date.now() - entry.timestamp > this.cacheTtlMs) {
            this.cache.delete(key);
            return null;
        }

        console.log(`[Cache] Hit for ${provider}/${model}`);
        return entry.response;
    }

    /**
     * Store response in cache
     */
    set(
        provider: string,
        model: string,
        messages: OpenAIMessage[],
        options: CompletionOptions,
        response: string
    ): void {
        if (!this._enabled) {
            return;
        }

        const key = this.generateKey(provider, model, messages, options);

        // Evict oldest entries if cache is full
        if (this.cache.size >= MAX_CACHE_SIZE) {
            this.evictOldest();
        }

        this.cache.set(key, {
            response,
            timestamp: Date.now(),
            model,
            provider
        });

        console.log(`[Cache] Stored response for ${provider}/${model}`);
    }

    /**
     * Evict oldest entries
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * Clear all cached entries
     */
    clear(): void {
        this.cache.clear();
        console.log('[Cache] Cleared all entries');
    }

    /**
     * Clear expired entries
     */
    clearExpired(): void {
        const now = Date.now();
        let cleared = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.cacheTtlMs) {
                this.cache.delete(key);
                cleared++;
            }
        }

        if (cleared > 0) {
            console.log(`[Cache] Cleared ${cleared} expired entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        enabled: boolean;
        ttlMinutes: number;
        entriesByProvider: { [provider: string]: number };
    } {
        const entriesByProvider: { [provider: string]: number } = {};

        for (const entry of this.cache.values()) {
            entriesByProvider[entry.provider] = (entriesByProvider[entry.provider] || 0) + 1;
        }

        return {
            size: this.cache.size,
            enabled: this._enabled,
            ttlMinutes: Math.round(this.cacheTtlMs / 60000),
            entriesByProvider
        };
    }

    dispose(): void {
        this.cache.clear();
    }
}

// Singleton instance
let cacheServiceInstance: CacheService | null = null;

export function getCacheService(): CacheService {
    if (!cacheServiceInstance) {
        cacheServiceInstance = new CacheService();
    }
    return cacheServiceInstance;
}

export function disposeCacheService(): void {
    if (cacheServiceInstance) {
        cacheServiceInstance.dispose();
        cacheServiceInstance = null;
    }
}
