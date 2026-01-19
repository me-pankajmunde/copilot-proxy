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
| `Copilot Proxy: Setup Port Forwarding` | Configure automatic port forwarding |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `copilot-proxy.port` | `5001` | Port for the API server |
| `copilot-proxy.autoStart` | `false` | Auto-start server on VS Code launch |
| `copilot-proxy.autoForwardPort` | `false` | Automatically configure port forwarding when server starts |
| `copilot-proxy.portVisibility` | `private` | Default port visibility (`private` or `public`) |

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

## Anthropic SDK Support

The proxy also exposes Anthropic-compatible API endpoints, allowing you to use the Anthropic SDK with GitHub Copilot models.

### Base URL

Use `http://127.0.0.1:5001/anthropic` as the base URL (note the `/anthropic` prefix).

### API Endpoints

#### Create Message

```bash
curl http://127.0.0.1:5001/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3.5-sonnet",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

#### Streaming Messages

```bash
curl http://127.0.0.1:5001/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3.5-sonnet",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Write a haiku about coding"}
    ],
    "stream": true
  }'
```

### Using with Python (Anthropic SDK)

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://127.0.0.1:5001/anthropic",
    api_key="YOUR_TOKEN"  # Token from the extension
)

# Create a message
message = client.messages.create(
    model="claude-3.5-sonnet",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Explain recursion in one sentence"}
    ]
)
print(message.content[0].text)

# Streaming
with client.messages.stream(
    model="claude-3.5-sonnet",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Write a poem about VS Code"}
    ]
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### Using with Node.js (Anthropic SDK)

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
    baseURL: 'http://127.0.0.1:5001/anthropic',
    apiKey: 'YOUR_TOKEN'
});

const message = await client.messages.create({
    model: 'claude-3.5-sonnet',
    max_tokens: 1024,
    messages: [
        { role: 'user', content: 'Hello!' }
    ]
});

console.log(message.content[0].text);

// Streaming
const stream = await client.messages.stream({
    model: 'claude-3.5-sonnet',
    max_tokens: 1024,
    messages: [
        { role: 'user', content: 'Write a haiku' }
    ]
});

for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        process.stdout.write(chunk.delta.text);
    }
}
```

### Using with Claude Code CLI

Configure the Claude CLI to use the proxy:

```bash
# Set environment variables
export ANTHROPIC_API_KEY="YOUR_TOKEN"
export ANTHROPIC_BASE_URL="http://127.0.0.1:5001/anthropic"

# Use Claude CLI
claude "Explain async/await in JavaScript"
```

Or create a configuration file:

```bash
# ~/.config/claude/config.json
{
  "api_key": "YOUR_TOKEN",
  "base_url": "http://127.0.0.1:5001/anthropic"
}
```

### Anthropic API Differences

The Anthropic endpoint implementation has these characteristics:

- **Required field**: `max_tokens` is required (unlike OpenAI's optional `max_tokens`)
- **System messages**: Supports both the `system` parameter and system role messages in the array (both are merged, with `system` parameter taking precedence)
- **Streaming format**: Uses Anthropic's event-based streaming format (`message_start`, `content_block_delta`, etc.) instead of OpenAI's SSE chunks
- **Model names**: Use the same model IDs as with OpenAI endpoints (e.g., `gpt-4o`, `claude-3.5-sonnet`, or `copilot/gpt-4o`)
- **Authentication**: Uses `x-api-key` header (Anthropic style) or `Authorization: Bearer` header (both accepted)

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

For security, the server only binds to `127.0.0.1`. It cannot be accessed from other machines on your network without port forwarding.

**Port Forwarding**: Use the built-in automatic port forwarding feature to access the API remotely. See [Automatic Port Forwarding](#automatic-port-forwarding) below.

### Rate Limits

The extension is subject to GitHub Copilot's rate limits. If you encounter rate limiting, wait a moment before retrying.

## Automatic Port Forwarding

The extension can automatically configure VS Code's port forwarding to make the API accessible via a public URL.

### Quick Setup

**Option 1: Enable in Settings**

1. Open VS Code Settings (`Cmd+,` / `Ctrl+,`)
2. Search for **"copilot-proxy.autoForwardPort"**
3. Enable the checkbox
4. (Optional) Set **"copilot-proxy.portVisibility"** to `public` for external access
5. Start/restart the server

**Option 2: Manual Setup**

1. Start the Copilot Proxy server
2. Click **"Setup Port Forwarding"** in the notification
3. Choose **"Private"** (localhost forwarding) or **"Public"** (accessible via URL)
4. Open the **PORTS** view to see the forwarded URL

**Option 3: Command Palette**

1. Start the server
2. Run **"Copilot Proxy: Setup Port Forwarding"** from Command Palette
3. Select visibility preference

### How It Works

When enabled, the extension automatically creates `.vscode/settings.json` in your workspace with:

```json
{
  "remote.autoForwardPorts": true,
  "remote.autoForwardPortsSource": "process",
  "remote.portsAttributes": {
    "5001": {
      "label": "Copilot Proxy API",
      "onAutoForward": "notify"
    }
  }
}
```

VS Code then:
- Detects the running server on port 5001
- Automatically forwards the port
- Shows it in the **PORTS** view (bottom panel)
- Provides a forwarded URL you can use

### Accessing the Forwarded API

Once configured, find your forwarded URL in the PORTS view:

1. Open the **PORTS** view (click PORTS tab at bottom)
2. Find **"Copilot Proxy API (5001)"**
3. Right-click → **"Copy Forwarded Address"**
4. Use this URL in your API client:

```python
from openai import OpenAI

# Use the forwarded URL
client = OpenAI(
    base_url="https://xxx-5001.app.github.dev/v1",
    api_key="YOUR_TOKEN"  # Same token from the extension
)
```

### Making Port Public

To access from outside your network:

1. Open **PORTS** view
2. Right-click the forwarded port (5001)
3. Select **"Port Visibility" → "Public"**
4. The URL changes to a public GitHub URL
5. Share this URL (with the token) to access remotely

### Security Notes

- **Authentication required**: Bearer token is still mandatory for all requests
- **GitHub auth for public ports**: Public forwarded ports require **interactive browser-based GitHub authentication**, which doesn't work with API clients
- **Temporary URLs**: Forwarded URLs change when VS Code/Codespaces restarts
- **Rate limits**: GitHub Copilot rate limits still apply

### Important: Public Port Limitations

⚠️ **VS Code's public port forwarding requires interactive GitHub login and will NOT work with API clients (OpenAI SDK, curl, etc.).**

For programmatic API access, use one of these alternatives:

**Option 1: Use Cloudflare Tunnel (Recommended)**
```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# Start tunnel
./cloudflared tunnel --url http://localhost:5001

# Copy the https://xxx.trycloudflare.com URL and use it:
```

```python
client = OpenAI(
    base_url="https://xxx.trycloudflare.com/v1",  # From cloudflared output
    api_key="YOUR_TOKEN"
)
```

**Option 2: Use ngrok**
```bash
# Install from https://ngrok.com
ngrok http 5001

# Use the provided https://xxx.ngrok-free.app URL
```

**Option 3: Keep Port Private**
Only use VS Code port forwarding with **private** visibility if accessing from:
- Same machine (localhost)
- Same Codespace/Remote session
- VS Code Remote extensions

### Use Cases

- **Local Development**: Use localhost URL directly
- **Remote Development**: Use private port forwarding within same session
- **External Access**: Use Cloudflare Tunnel or ngrok (NOT VS Code public ports)
- **Team Collaboration**: Share tunneled URL (cloudflared/ngrok)
- **CI/CD Integration**: Deploy in remote environment, use localhost

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
