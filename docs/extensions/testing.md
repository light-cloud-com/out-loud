# Extension testing

End-to-end test flows for the Chrome, Firefox, and Safari extensions against the local Out Loud desktop app.

## Contents

- [Setup](#setup)
- [Chrome](#chrome)
- [Firefox](#firefox)
- [Safari](#safari)
- [Troubleshooting](#troubleshooting)
- [Packaging for stores](#packaging-for-stores)
- [See also](#see-also)

## Setup

Every extension talks to the desktop app's local HTTP server. Start it first:

```bash
npm run electron:dev
```

Verify it's listening on port `51730`:

```bash
npm run extension:test
# or
curl http://127.0.0.1:51730/api/v1/audio/voices
```

## Chrome

### Load the extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → pick the `chrome-extension/` folder

### Smoke test

1. Click the extension icon — status should read **Ready** (green). If it says **Disconnected**, the desktop app isn't running.
2. Select text on any webpage, open the side panel — the selection should appear in the textarea.
3. Click **Play** — audio streams with the progress bar updating.
4. Switch language + voice dropdowns — options refresh and play correctly.

### Debug

`chrome://extensions/` → **Out Loud** → _Inspect views: service worker_ → Console.

## Firefox

1. `about:debugging` → **This Firefox**
2. **Load Temporary Add-on**
3. Pick `chrome-extension/manifest.json`

The same codebase runs in Firefox. Some Manifest V3 features may behave slightly differently.

## Safari

```bash
npm run extension:safari:convert
open safari-extension/SafariExtension/*.xcodeproj
```

Build and run from Xcode, then enable in **Safari → Settings → Extensions**. Full build flow in [`../../safari-extension/README.md`](../../safari-extension/README.md).

## Troubleshooting

### Status shows "Disconnected"

- Desktop app running? `npm run electron:dev`
- Port `51730` free? `lsof -i :51730`
- Check browser console for errors

### No audio playback

- Check the browser console
- `AudioContext` requires a user gesture — make sure play is actually clicked
- Try the one-shot endpoint (`POST /api/v1/audio/speech`) to isolate streaming issues

### Extension won't load

- Validate `manifest.json` syntax
- Confirm every referenced file exists
- Check the extension console

### Safari-specific

- App must be signed — see [`../build/mac-app-store.md`](../build/mac-app-store.md)
- Extension permissions granted in Safari settings?
- HTTP server reachable?

## Packaging for stores

### Chrome Web Store

```bash
npm run extension:chrome:pack
# Upload releases/extensions/out-loud-chrome.zip
```

### Firefox Add-ons

The same zip works — upload to [addons.mozilla.org](https://addons.mozilla.org/).

### Mac App Store (Safari)

Archive in Xcode, upload to App Store Connect. See [`../build/mac-app-store.md`](../build/mac-app-store.md).

## See also

- [`../../chrome-extension/README.md`](../../chrome-extension/README.md) — Chrome-specific setup and auto-launch
- [`../../safari-extension/README.md`](../../safari-extension/README.md) — Safari build flow
- [`../app/api.md`](../app/api.md) — the HTTP API the extensions call
