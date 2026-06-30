# Out Loud for Slack — Marketplace app (relay hybrid)

Goal: a Slack **Marketplace** app that adds a **"Read out loud"** action to messages and
plays them through the user's **local Out Loud desktop app** (local TTS — audio is
generated on-device and never leaves the machine).

## Why a relay is unavoidable

A Marketplace Slack app runs **no code on the user's machine** — Slack only ever calls
_your_ public backend (slash commands / message shortcuts / Events API). Slack's cloud
cannot reach `127.0.0.1`. The only way to bridge Slack → the local app is to have the
**desktop app open an outbound connection to a relay** and keep it alive; Slack then
talks to the relay, and the relay pushes down that connection.

## Architecture

```
Slack client (desktop or web)
  ⋯ on a message → "Read out loud"          (message shortcut; Slack-rendered)
        │  Slack cloud → HTTPS POST (signed)
        ▼
RELAY  (always-on, public HTTPS + WSS; NO TTS, no GPU)
  - verifies Slack signature
  - extracts { teamId, slackUserId, messageText }
  - finds the desktop socket paired to that Slack user
  - pushes { type: "speak", text } down the socket
        │  WSS (authenticated, outbound from the app)
        ▼
Out Loud desktop app
  - receives "speak" → existing generateTTS() → plays LOCALLY ✅
```

## Components

### 1. Slack app ("Out Loud for Slack")

- **Message shortcut** `read_out_loud` ("Read out loud") — shows in a message's `⋯` menu
  (works in **desktop and web**). The interaction payload already includes the message
  text, so no message-history scopes are needed.
- Distribution: **public** (OAuth) for the Marketplace.
- Interactivity Request URL → `RELAY/slack/interactions`.
- Scopes (minimal): `commands` (for shortcuts) + `chat:write` (to post an ephemeral
  "▶️ playing on your device" / error confirmation). No `*:history` needed.
- Must ack the interaction within 3s, then route asynchronously.

### 2. Relay backend (small, always-on)

- `POST /slack/oauth/callback` — install / store per-team token.
- `POST /slack/interactions` — verify Slack signing secret; route to paired desktop.
- `WSS /agent` — desktop apps connect with a device token; relay maps socket ↔ slackUser.
- `POST /pair/start` + `POST /pair/confirm` — device-code pairing (below).
- Store: pairings (slackUserId ↔ deviceId), Slack OAuth tokens, device tokens.
  Small DB / KV. **No audio, no message storage.**
- Deploy target: Light Cloud (TBD).

### 3. Desktop app (`electron/`)

- New `electron/slack-bridge.ts`: authenticated WSS client to the relay with
  reconnect/backoff; on `{type:"speak",text}` → feed into the existing TTS path
  (same `generateTTS` the HTTP API uses).
- **"Connect Slack"** flow in the UI: shows a short device code; user enters it in a
  Slack modal / relay web page to bind their Slack identity to this install.
- Settings (reuse shared settings/store): relay enabled, paired state, voice.
- Reuse the existing anonymous install ID (store.ts opaque ID) as `deviceId`.

## Pairing (device-code; no account system to build)

1. User clicks **Connect Slack** in the desktop app → app calls `RELAY/pair/start`
   (auth: deviceToken) → relay returns a short code (e.g. `OUTLOUD-7H2Q`).
2. In Slack, the app's first use / a `/outloud connect` command / App Home shows a field;
   user enters the code → Slack → `RELAY/pair/confirm` binds `slackUserId ↔ deviceId`.
3. Thereafter "Read out loud" routes to that device.

## Security & privacy

- All transport TLS (`https`/`wss`).
- **Message text transits the relay** (in memory, not stored) on the way to the device —
  this MUST be disclosed in the privacy policy. Audio stays local.
- Verify Slack request signatures; authenticate every desktop socket with a per-device
  token; scope each push to the bound device only.

## Phased plan

- **Phase 1 — core bridge (no Slack needed):** `slack-bridge.ts` + a minimal relay
  (even run locally) + device-code pairing. Prove: POST text to relay → desktop speaks.
  De-risks the hard part without Slack review.
- **Phase 2 — real Slack app (dev/single workspace):** message shortcut → relay →
  desktop. Test with Slack "internal distribution" (no Marketplace review yet).
- **Phase 3 — Marketplace submission:** privacy policy, security questionnaire, branding,
  OAuth hardening, review cycle.

## Decisions needed

1. **Pairing model** — device-code (recommended, no login) vs. building real accounts.
2. **Relay hosting** — Light Cloud? region? DB choice (Postgres / KV / SQLite).
3. **v1 surface** — message shortcut only (recommended) vs. also slash command / App Home.
4. **Monetization/limits** — relay is cheap (no TTS), but is there a usage cap or paid tier?

## Effort

~2–3 weeks engineering across the three components, plus Slack's review cycle for Phase 3.
