# Troubleshooting Port Forwarding

## Common Issues and Solutions

### 406 Error (Not Acceptable)

**Symptoms:**
- `APIStatusError: Error code: 406` when using OpenAI SDK
- Works locally but fails with forwarded URL

**Causes:**
1. VS Code forwarding proxy modifying headers
2. Accept header mismatch
3. Content-Type negotiation issues

**Solutions:**

✅ **Solution 1: Update the extension** (DONE)
The latest version includes fixes for forwarded URL support:
- Enhanced CORS headers
- Better Content-Type handling
- Support for x-forwarded-* headers

✅ **Solution 2: Restart the server**
1. Stop the Copilot Proxy server
2. Restart it (Command: "Copilot Proxy: Start Server")
3. Get a fresh token
4. Try again

✅ **Solution 3: Check port visibility**
1. Open PORTS view (bottom panel)
2. Right-click port 5001
3. Ensure "Port Visibility" is set correctly:
   - **Private**: Only accessible from your machine
   - **Public**: Accessible from anywhere (requires GitHub auth)

✅ **Solution 4: Verify the URL format**
```python
# Correct format - must include /v1
base_url="https://xxx-5001.app.github.dev/v1"

# Wrong - missing /v1
base_url="https://xxx-5001.app.github.dev"
```

### 401 Error (Unauthorized)

**Causes:**
- Token mismatch
- Token expired (changes on server restart)

**Solutions:**
1. Copy fresh token: Command Palette → "Copilot Proxy: Copy API Token"
2. Verify token in your code matches exactly
3. Check for extra spaces/newlines in token

### Connection Timeout

**Causes:**
- Port not forwarded
- GitHub authentication required
- Firewall blocking connection

**Solutions:**
1. Check PORTS view shows the forwarded port
2. Try making port public
3. Authenticate with GitHub in browser
4. Check VS Code is connected (if using Codespaces/Remote)

### Testing Script

Use the included test script to diagnose issues:

```bash
# Run the test script
python test-forwarded.py

# It will prompt for:
# 1. Forwarded URL (from PORTS view)
# 2. API Token (from Copy Token command)

# Tests performed:
# - Health check
# - List models
# - Chat completion
# - Streaming
```

### Debug Output

Check VS Code Output panel for server logs:
1. View → Output
2. Select "Copilot Proxy" from dropdown
3. Look for request logs showing:
   - Request method and path
   - "(forwarded)" indicator
   - Any error messages

### Still Having Issues?

1. **Check server is running:**
   - Status bar should show "Copilot Proxy: 5001"
   - Green indicator (not red)

2. **Verify forwarding is active:**
   - PORTS view shows port 5001
   - "Forwarded Address" column has a URL

3. **Test locally first:**
   ```python
   # Test with localhost
   client = OpenAI(
       base_url="http://127.0.0.1:5001/v1",
       api_key="YOUR_TOKEN"
   )
   # If this works, issue is with forwarding
   ```

4. **Check GitHub authentication:**
   - Public ports require GitHub authentication
   - Try accessing the forwarded URL in browser
   - Should redirect to GitHub login

5. **Try different network:**
   - Some corporate networks block forwarded ports
   - Try from different device/network
   - Use mobile hotspot for testing

### Known Limitations

1. **Forwarded URLs are temporary**
   - Change when VS Code restarts
   - Change when Codespace restarts
   - Need to update clients with new URL

2. **GitHub rate limits apply**
   - Both Copilot and forwarding limits
   - May need to wait if rate limited

3. **Authentication required**
   - Bearer token always required
   - Public ports need GitHub auth
   - Private ports need machine access

### Example Working Configuration

```python
from openai import OpenAI

# Configuration
FORWARDED_URL = "https://xxx-5001.app.github.dev/v1"
TOKEN = "your-token-here"  # From Copy Token command

# Create client
client = OpenAI(
    base_url=FORWARDED_URL,
    api_key=TOKEN,
    timeout=30.0  # Increase timeout for forwarded URLs
)

# Test connection
try:
    models = client.models.list()
    print(f"✅ Connected! Found {len(models.data)} models")
except Exception as e:
    print(f"❌ Error: {e}")
```

### Quick Checklist

- [ ] Server is running (green status bar)
- [ ] Port 5001 visible in PORTS view
- [ ] Port visibility set (Private or Public)
- [ ] Forwarded URL copied correctly
- [ ] URL includes `/v1` at the end
- [ ] Fresh token copied from extension
- [ ] Token pasted without extra spaces
- [ ] VS Code Output panel shows no errors
- [ ] Test script runs successfully

If all checks pass and still not working, file an issue with:
- VS Code version
- Extension version  
- Error logs from Output panel
- test-forwarded.py output
