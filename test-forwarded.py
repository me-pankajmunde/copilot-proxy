#!/usr/bin/env python3
"""
Test script for forwarded URL access
"""
import os
import sys

try:
    from openai import OpenAI
except ImportError:
    print("Error: openai package not installed")
    print("Install with: pip install openai")
    sys.exit(1)

# Configure these values
FORWARDED_URL = input("Enter your forwarded URL (e.g., https://xxx-5001.app.github.dev): ").strip()
API_TOKEN = input("Enter your API token: ").strip()

if not FORWARDED_URL or not API_TOKEN:
    print("Error: URL and token are required")
    sys.exit(1)

# Add /v1 if not present
if not FORWARDED_URL.endswith('/v1'):
    FORWARDED_URL = f"{FORWARDED_URL}/v1"

print(f"\nTesting connection to: {FORWARDED_URL}")
print("=" * 60)

try:
    # Create client
    client = OpenAI(
        base_url=FORWARDED_URL,
        api_key=API_TOKEN,
        timeout=30.0,
        max_retries=2
    )
    
    # Test 1: Health check (if available)
    print("\n1. Testing health endpoint...")
    import requests
    health_url = FORWARDED_URL.replace('/v1', '/health')
    try:
        resp = requests.get(health_url, timeout=5)
        print(f"   Health check: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"   Health check failed: {e}")
    
    # Test 2: List models
    print("\n2. Listing available models...")
    models = client.models.list()
    print(f"   Found {len(models.data)} models:")
    for model in models.data[:5]:  # Show first 5
        print(f"   - {model.id}")
    
    # Test 3: Simple completion
    print("\n3. Testing chat completion...")
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": "Say 'Hello from forwarded URL!' in one line"}
        ],
        max_tokens=50
    )
    print(f"   Response: {response.choices[0].message.content}")
    
    # Test 4: Streaming
    print("\n4. Testing streaming completion...")
    print("   Response: ", end="", flush=True)
    stream = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": "Count to 5"}
        ],
        stream=True,
        max_tokens=50
    )
    for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)
    print()
    
    print("\n" + "=" * 60)
    print("✅ All tests passed!")
    print("=" * 60)

except Exception as e:
    print(f"\n❌ Error: {e}")
    print("\nDebug information:")
    print(f"  URL: {FORWARDED_URL}")
    print(f"  Token length: {len(API_TOKEN)}")
    print(f"  Error type: {type(e).__name__}")
    
    if hasattr(e, 'response'):
        print(f"  Status code: {e.response.status_code}")
        print(f"  Response body: {e.response.text}")
    
    print("\nTroubleshooting:")
    print("1. Verify the server is running in VS Code")
    print("2. Check the PORTS view shows the forwarded URL")
    print("3. Make sure the token matches (copy from 'Copy Token' command)")
    print("4. Try making the port public (right-click in PORTS view)")
    print("5. Check VS Code Output panel for server logs")
    sys.exit(1)
