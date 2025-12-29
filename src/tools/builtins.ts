/**
 * Built-in tools for testing LLM tool-use capabilities
 */

import { Tool, ToolExecutionResult, RegisteredTool } from './types';

interface BuiltinToolDefinition {
    tool: Tool;
    executor: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

/**
 * Built-in tools registry
 */
export const BUILTIN_TOOLS: Record<string, BuiltinToolDefinition> = {
    get_current_time: {
        tool: {
            type: 'function',
            function: {
                name: 'get_current_time',
                description: 'Get the current date and time. Returns ISO format timestamp and human-readable format.',
                parameters: {
                    type: 'object',
                    properties: {
                        timezone: {
                            type: 'string',
                            description: 'Optional timezone (e.g., "UTC", "America/New_York"). Defaults to local time.'
                        },
                        format: {
                            type: 'string',
                            enum: ['iso', 'human', 'both'],
                            description: 'Output format. Default: both'
                        }
                    }
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const date = new Date();
            const format = (args.format as string) || 'both';
            
            let result: string;
            if (format === 'iso') {
                result = date.toISOString();
            } else if (format === 'human') {
                result = date.toLocaleString();
            } else {
                result = `**Current Time**\n- ISO: ${date.toISOString()}\n- Local: ${date.toLocaleString()}\n- Timestamp: ${date.getTime()}`;
            }
            
            return { success: true, result, executionTimeMs: Date.now() - start };
        }
    },

    fetch_url: {
        tool: {
            type: 'function',
            function: {
                name: 'fetch_url',
                description: 'Fetch content from a URL. Returns HTTP status, headers, and response body. Useful for retrieving web content, API responses, etc.',
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to fetch (must be http or https)'
                        },
                        method: {
                            type: 'string',
                            enum: ['GET', 'POST', 'PUT', 'DELETE'],
                            description: 'HTTP method. Default: GET'
                        },
                        headers: {
                            type: 'object',
                            description: 'Optional HTTP headers as key-value pairs'
                        },
                        body: {
                            type: 'string',
                            description: 'Request body for POST/PUT requests'
                        }
                    },
                    required: ['url']
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const url = args.url as string;
            
            // Validate URL
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return {
                    success: false,
                    error: 'Invalid URL: must start with http:// or https://',
                    executionTimeMs: Date.now() - start
                };
            }

            try {
                const response = await fetch(url, {
                    method: (args.method as string) || 'GET',
                    headers: args.headers as Record<string, string> || {},
                    body: args.body as string | undefined,
                    signal: AbortSignal.timeout(15000)
                });

                const contentType = response.headers.get('content-type') || 'unknown';
                let body = await response.text();
                
                // Truncate large responses
                const maxLength = 8000;
                if (body.length > maxLength) {
                    body = body.substring(0, maxLength) + `\n\n... [Response truncated, total ${body.length} characters]`;
                }

                const result = [
                    `**HTTP Response**`,
                    `- Status: ${response.status} ${response.statusText}`,
                    `- Content-Type: ${contentType}`,
                    `- Content-Length: ${response.headers.get('content-length') || 'unknown'}`,
                    ``,
                    `**Body:**`,
                    '```',
                    body,
                    '```'
                ].join('\n');

                return {
                    success: response.ok,
                    result,
                    executionTimeMs: Date.now() - start
                };
            } catch (err) {
                return {
                    success: false,
                    error: `Fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                    executionTimeMs: Date.now() - start
                };
            }
        }
    },

    calculate: {
        tool: {
            type: 'function',
            function: {
                name: 'calculate',
                description: 'Perform mathematical calculations. Supports basic arithmetic (+, -, *, /, %), parentheses, and common math operations.',
                parameters: {
                    type: 'object',
                    properties: {
                        expression: {
                            type: 'string',
                            description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3", "(10 + 5) / 3")'
                        }
                    },
                    required: ['expression']
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const expression = args.expression as string;

            try {
                // Sanitize expression - only allow safe characters
                const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
                if (sanitized !== expression.replace(/\s/g, '').replace(/[0-9+\-*/().%]/g, '') && 
                    expression.replace(/\s/g, '') !== sanitized.replace(/\s/g, '')) {
                    return {
                        success: false,
                        error: 'Invalid characters in expression. Only numbers and operators (+, -, *, /, %, parentheses) are allowed.',
                        executionTimeMs: Date.now() - start
                    };
                }

                // Safe evaluation using Function constructor
                const result = Function(`"use strict"; return (${sanitized})`)();
                
                if (typeof result !== 'number' || !isFinite(result)) {
                    return {
                        success: false,
                        error: 'Expression did not evaluate to a valid number',
                        executionTimeMs: Date.now() - start
                    };
                }

                return {
                    success: true,
                    result: `**Calculation Result**\n- Expression: \`${expression}\`\n- Result: **${result}**`,
                    executionTimeMs: Date.now() - start
                };
            } catch (err) {
                return {
                    success: false,
                    error: `Calculation error: ${err instanceof Error ? err.message : 'Invalid expression'}`,
                    executionTimeMs: Date.now() - start
                };
            }
        }
    },

    json_parse: {
        tool: {
            type: 'function',
            function: {
                name: 'json_parse',
                description: 'Parse JSON string and optionally extract a value by path. Useful for working with API responses or structured data.',
                parameters: {
                    type: 'object',
                    properties: {
                        json: {
                            type: 'string',
                            description: 'JSON string to parse'
                        },
                        path: {
                            type: 'string',
                            description: 'Optional dot-notation path to extract (e.g., "data.items[0].name", "users.length")'
                        },
                        pretty: {
                            type: 'boolean',
                            description: 'Pretty print the output. Default: true'
                        }
                    },
                    required: ['json']
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();

            try {
                const obj = JSON.parse(args.json as string);
                let result = obj;

                // Extract by path if specified
                if (args.path) {
                    const pathStr = args.path as string;
                    const parts = pathStr.split(/\.|\[|\]/).filter(p => p !== '');
                    
                    result = parts.reduce((current, part) => {
                        if (current === undefined || current === null) return undefined;
                        const index = parseInt(part);
                        return isNaN(index) ? current[part] : current[index];
                    }, obj);
                }

                const pretty = args.pretty !== false;
                const formatted = pretty 
                    ? JSON.stringify(result, null, 2) 
                    : JSON.stringify(result);

                const output = args.path
                    ? `**JSON Path Query**\n- Path: \`${args.path}\`\n- Result:\n\`\`\`json\n${formatted}\n\`\`\``
                    : `**Parsed JSON:**\n\`\`\`json\n${formatted}\n\`\`\``;

                return {
                    success: true,
                    result: output,
                    executionTimeMs: Date.now() - start
                };
            } catch (err) {
                return {
                    success: false,
                    error: `JSON parse error: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
                    executionTimeMs: Date.now() - start
                };
            }
        }
    },

    generate_uuid: {
        tool: {
            type: 'function',
            function: {
                name: 'generate_uuid',
                description: 'Generate a random UUID (v4) or multiple UUIDs.',
                parameters: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'number',
                            description: 'Number of UUIDs to generate. Default: 1, Max: 10'
                        }
                    }
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const count = Math.min(Math.max(1, (args.count as number) || 1), 10);

            const uuids: string[] = [];
            for (let i = 0; i < count; i++) {
                uuids.push(crypto.randomUUID());
            }

            const result = count === 1
                ? `**Generated UUID:** \`${uuids[0]}\``
                : `**Generated ${count} UUIDs:**\n${uuids.map((u, i) => `${i + 1}. \`${u}\``).join('\n')}`;

            return { success: true, result, executionTimeMs: Date.now() - start };
        }
    },

    base64_encode: {
        tool: {
            type: 'function',
            function: {
                name: 'base64_encode',
                description: 'Encode or decode Base64 strings.',
                parameters: {
                    type: 'object',
                    properties: {
                        input: {
                            type: 'string',
                            description: 'String to encode or decode'
                        },
                        operation: {
                            type: 'string',
                            enum: ['encode', 'decode'],
                            description: 'Operation to perform. Default: encode'
                        }
                    },
                    required: ['input']
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const input = args.input as string;
            const operation = (args.operation as string) || 'encode';

            try {
                let result: string;
                if (operation === 'decode') {
                    result = Buffer.from(input, 'base64').toString('utf-8');
                } else {
                    result = Buffer.from(input).toString('base64');
                }

                return {
                    success: true,
                    result: `**Base64 ${operation === 'decode' ? 'Decoded' : 'Encoded'}:**\n\`\`\`\n${result}\n\`\`\``,
                    executionTimeMs: Date.now() - start
                };
            } catch (err) {
                return {
                    success: false,
                    error: `Base64 ${operation} failed: ${err instanceof Error ? err.message : 'Invalid input'}`,
                    executionTimeMs: Date.now() - start
                };
            }
        }
    },

    string_transform: {
        tool: {
            type: 'function',
            function: {
                name: 'string_transform',
                description: 'Transform strings: change case, count characters/words, reverse, etc.',
                parameters: {
                    type: 'object',
                    properties: {
                        input: {
                            type: 'string',
                            description: 'Input string to transform'
                        },
                        operation: {
                            type: 'string',
                            enum: ['uppercase', 'lowercase', 'titlecase', 'reverse', 'count', 'trim', 'slugify'],
                            description: 'Transformation to apply'
                        }
                    },
                    required: ['input', 'operation']
                }
            }
        },
        executor: async (args) => {
            const start = Date.now();
            const input = args.input as string;
            const operation = args.operation as string;

            let result: string;
            switch (operation) {
                case 'uppercase':
                    result = input.toUpperCase();
                    break;
                case 'lowercase':
                    result = input.toLowerCase();
                    break;
                case 'titlecase':
                    result = input.replace(/\b\w/g, c => c.toUpperCase());
                    break;
                case 'reverse':
                    result = input.split('').reverse().join('');
                    break;
                case 'count':
                    const chars = input.length;
                    const words = input.trim().split(/\s+/).filter(w => w.length > 0).length;
                    const lines = input.split('\n').length;
                    result = `**String Statistics:**\n- Characters: ${chars}\n- Words: ${words}\n- Lines: ${lines}`;
                    return { success: true, result, executionTimeMs: Date.now() - start };
                case 'trim':
                    result = input.trim();
                    break;
                case 'slugify':
                    result = input.toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                    break;
                default:
                    return { success: false, error: `Unknown operation: ${operation}`, executionTimeMs: Date.now() - start };
            }

            return {
                success: true,
                result: `**${operation.charAt(0).toUpperCase() + operation.slice(1)} Result:**\n\`\`\`\n${result}\n\`\`\``,
                executionTimeMs: Date.now() - start
            };
        }
    }
};

/**
 * Get built-in tools as RegisteredTool array
 */
export function getBuiltinTools(enabledNames: string[]): RegisteredTool[] {
    const allNames = Object.keys(BUILTIN_TOOLS);
    const namesToUse = enabledNames.length > 0 
        ? enabledNames.filter(n => allNames.includes(n))
        : allNames;

    return namesToUse.map(name => ({
        tool: BUILTIN_TOOLS[name].tool,
        source: 'builtin' as const,
        executor: BUILTIN_TOOLS[name].executor
    }));
}

/**
 * Get all available built-in tool names
 */
export function getBuiltinToolNames(): string[] {
    return Object.keys(BUILTIN_TOOLS);
}
