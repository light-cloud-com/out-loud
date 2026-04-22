#!/bin/bash

# Install Native Messaging Host for Out Loud TTS Extension

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.outloud.tts"
HOST_PATH="$SCRIPT_DIR/out-loud-host"

# Make host executable
chmod +x "$HOST_PATH"

# Chrome native messaging hosts directory (macOS)
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_DIR"

# Get extension ID from manifest or use placeholder
# User needs to replace this with their actual extension ID after loading
read -p "Enter your Chrome extension ID (from chrome://extensions): " EXT_ID

if [ -z "$EXT_ID" ]; then
  echo "Error: Extension ID is required"
  exit 1
fi

# Create manifest
cat > "$CHROME_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Out Loud TTS Native Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo ""
echo "Native messaging host installed successfully!"
echo ""
echo "Manifest location: $CHROME_DIR/$HOST_NAME.json"
echo "Host location: $HOST_PATH"
echo ""
echo "Now reload your Chrome extension and it should connect automatically."
