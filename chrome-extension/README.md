# Out Loud — Chrome extension

Read selected text aloud on any webpage. This is a thin UI layer that defers to the Out Loud desktop app over `localhost:51730` — everything stays on your machine.

For the big-picture architecture, see the [root README](../README.md#how-it-works).

## Contents

- [Install](#install)
- [Use](#use)
- [Auto-start the desktop app on login (macOS)](#auto-start-the-desktop-app-on-login-macos)
- [Verify the API](#verify-the-api)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Related docs](#related-docs)
- [License](#license)

## Install

1. Install the Out Loud desktop app — see [root README → Install](../README.md#install).
2. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** and select this `chrome-extension/` folder

The extension auto-connects to the desktop app as long as it's running.

## Use

1. Select text on any webpage.
2. Click the Out Loud extension icon to open the side panel.
3. Pick a voice and language.
4. Click play.

## Auto-start the desktop app on login (macOS)

If you'd rather not launch the app manually every time, register a launch agent:

```bash
cat > ~/Library/LaunchAgents/com.outloud.server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.outloud.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Out Loud.app/Contents/MacOS/Out Loud</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/outloud.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/outloud.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.outloud.server.plist
```

Manage it:

```bash
launchctl start  com.outloud.server
launchctl stop   com.outloud.server
launchctl unload ~/Library/LaunchAgents/com.outloud.server.plist  # uninstall
tail -f /tmp/outloud.log
```

## Verify the API

```bash
curl -s http://127.0.0.1:51730/api/v1/audio/voices | head -c 200
```

If you get JSON back, the extension will find the server. For the full API, see [`../docs/app/api.md`](../docs/app/api.md).

## Troubleshooting

### Status shows "Disconnected"

The desktop app isn't running, or isn't on port `51730`. Launch Out Loud, then reopen the side panel.

### Extension doesn't pick up selected text

Refresh the webpage after installing the extension — content scripts don't inject into already-open tabs.

### Port conflict

```bash
lsof -i :51730
```

## Repository layout

```
chrome-extension/
├── manifest.json         Extension config (Manifest V3)
├── background.js         Service worker
├── content.js            Text selection detection
├── sidepanel.{html,js}   Side-panel UI
├── options.{html,js}     Options page
├── src/                  TTS engine, streaming player, utilities
└── icons/                Extension icons
```

## Related docs

- [`../docs/extensions/testing.md`](../docs/extensions/testing.md) — end-to-end testing
- [`../docs/app/api.md`](../docs/app/api.md) — HTTP API reference
- [`../safari-extension/README.md`](../safari-extension/README.md) — same codebase, Safari port

## License

[MIT](../LICENSE)
