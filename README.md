# Copilot OpenAI Proxy

A VS Code extension that exposes GitHub Copilot's language models through an OpenAI-compatible API. This allows you to use Copilot models with any tool or application that supports the OpenAI API.

## Features

- **OpenAI-Compatible API**: Exposes `/v1/chat/completions` and `/v1/models` endpoints
- **Streaming Support**: Full support for Server-Sent Events (SSE) streaming responses
- **Model Selection**: Access all Copilot models available for your subscription
- **Secure by Default**: Localhost-only binding with bearer token authentication

## Quick Start

1. Install the extension
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **"Copilot Proxy: Start Server"**
4. Copy the API token when prompted
5. Configure your client with:
   - **Base URL**: `http://127.0.0.1:5001/v1`
   - **API Key**: The token you copied

## Usage

### Available Commands

| Command | Description |
|---------|-------------|
| `Copilot Proxy: Start Server` | Start the API server |
| `Copilot Proxy: Stop Server` | Stop the API server |
| `Copilot Proxy: Copy API Token` | Copy the authentication token |
| `Copilot Proxy: Show Available Models` | List available Copilot models |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `copilot-proxy.port` | `5001` | Port for the API server |
| `copilot-proxy.autoStart` | `false` | Auto-start server on VS Code launch |

### API Endpoints

#### Health Check

Check if the server is running (no authentication required).

```bash
curl http://127.0.0.1:5001/health
```

#### List Models

Get all available Copilot models.

```bash
curl http://127.0.0.1:5001/v1/models \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Get Model

Get details about a specific model.

```bash
curl http://127.0.0.1:5001/v1/models/gpt-4o \
  -H "Authorization: Bearer YOUR_TOKEN"
```

You can also specify a provider prefix:

```bash
curl http://127.0.0.1:5001/v1/models/copilot/gpt-4o \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Chat Completions

Create a chat completion.

```bash
curl http://127.0.0.1:5001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

#### Streaming Completions

Stream chat completions with Server-Sent Events.

```bash
curl http://127.0.0.1:5001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Write a haiku about coding"}
    ],
    "stream": true
  }'
```

#### Compare Completions

Compare responses from multiple models simultaneously. Send the same prompt to multiple models and get all responses in parallel (max 10 models).

```bash
curl http://127.0.0.1:5001/v1/chat/completions/compare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "models": ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet"],
    "messages": [
      {"role": "user", "content": "Explain async/await"}
    ]
  }'
```

Response format:

```json
{
  "id": "compare-...",
  "created": 1234567890,
  "results": [
    {
      "model": "copilot/gpt-4o",
      "provider": "copilot",
      "response": "...",
      "latencyMs": 1234
    },
    {
      "model": "copilot/gpt-4o-mini",
      "provider": "copilot",
      "response": "...",
      "latencyMs": 567
    }
  ]
}
```

#### List Providers

Get all configured LLM providers.

```bash
curl http://127.0.0.1:5001/v1/providers \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Get Logs

Retrieve recent API request logs.

```bash
curl http://127.0.0.1:5001/v1/logs \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Add a limit parameter to control the number of logs returned (default: 100):

```bash
curl "http://127.0.0.1:5001/v1/logs?limit=50" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Get Log Statistics

Get statistics about API usage.

```bash
curl http://127.0.0.1:5001/v1/logs/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Get Cache Statistics

Get cache performance statistics.

```bash
curl http://127.0.0.1:5001/v1/cache/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Clear Cache

Clear the response cache.

```bash
curl -X POST http://127.0.0.1:5001/v1/cache/clear \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Using with Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:5001/v1",
    api_key="YOUR_TOKEN"  # Token from the extension
)

# List available models
models = client.models.list()
for model in models.data:
    print(f"- {model.id}")

# Chat completion
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Explain recursion in one sentence"}
    ]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Write a poem about VS Code"}
    ],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Using with Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: 'http://127.0.0.1:5001/v1',
    apiKey: 'YOUR_TOKEN'
});

const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
        { role: 'user', content: 'Hello!' }
    ]
});

console.log(response.choices[0].message.content);
```

## Available Models

The available models depend on your GitHub Copilot subscription. Common models include:

| Model | Description |
|-------|-------------|
| `gpt-4o` | High-quality, fast responses |
| `gpt-4o-mini` | Faster, efficient for simple tasks |
| `o1` | Advanced reasoning model |
| `o1-mini` | Faster reasoning model |
| `claude-3.5-sonnet` | Anthropic's Claude model |

Use the "Show Available Models" command or GET `/v1/models` to see your available models.

## Known Limitations

### System Messages

The VS Code Language Model API does not support the `system` role directly. System messages are automatically prepended to the first user message with a separator:

```
{system message content}

---

{first user message content}
```

If you only send system messages without user messages, they will be sent as a user message.

### Token Usage

The `usage` field in responses always returns zeros:

```json
{
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

This is because the VS Code Language Model API does not expose token count information.

### Localhost Only

For security, the server only binds to `127.0.0.1`. It cannot be accessed from other machines on your network.

### Rate Limits

The extension is subject to GitHub Copilot's rate limits. If you encounter rate limiting, wait a moment before retrying.

## Security

- **Localhost Binding**: The server only accepts connections from `127.0.0.1`
- **Bearer Token**: A random 64-character token is generated each time the server starts
- **No Persistence**: Tokens are not stored and change on each restart

## Troubleshooting

### "No Copilot models available"

1. Ensure GitHub Copilot extension is installed
2. Ensure you have an active Copilot subscription
3. Try signing out and back into GitHub in VS Code

### "Port already in use"

Change the port in settings:
1. Open Settings (`Cmd+,` / `Ctrl+,`)
2. Search for "copilot-proxy.port"
3. Change to an available port

### Requests failing with 401

The token changes each time the server starts. Copy the new token using:
- Click the status bar item, or
- Run "Copilot Proxy: Copy API Token" command

## Development

```bash
# Clone the repository
git clone https://github.com/your-username/copilot-openai-proxy

# Install dependencies
cd copilot-openai-proxy
npm install

# Compile
npm run compile

# Watch mode
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## License

MIT

## Disclaimer

This extension uses GitHub Copilot's Language Model API. Usage is subject to GitHub Copilot's terms of service and rate limits. This is not an official GitHub product.
