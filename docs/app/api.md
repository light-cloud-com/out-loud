# HTTP API

The Out Loud desktop app exposes a local HTTP API on `127.0.0.1:51730` for browser extensions, scripts, and CLI tools.

> 🔒 **Localhost only** — the server rejects non-loopback connections. Nothing leaves your machine.

## Contents

- [Quick examples](#quick-examples)
- [Endpoints](#endpoints)
  - [`GET /api/v1/audio/voices`](#get-apiv1audiovoices)
  - [`POST /api/v1/audio/speech`](#post-apiv1audiospeech)
  - [`POST /api/v1/audio/speech/stream`](#post-apiv1audiospeechstream)
  - [`GET /api/v1/settings`](#get-apiv1settings)
  - [`POST /api/v1/settings`](#post-apiv1settings)
  - [`GET /api/v1/openapi.yaml`](#get-apiv1openapiyaml)
- [OpenAPI spec](#openapi-spec)
- [See also](#see-also)

## Quick examples

```bash
# List voices
curl http://127.0.0.1:51730/api/v1/audio/voices

# Generate speech to a file
curl -X POST http://127.0.0.1:51730/api/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"voice":"af_heart","input":"Hello, world."}' \
  --output hello.wav

# Stream audio (chunked)
curl -X POST http://127.0.0.1:51730/api/v1/audio/speech/stream \
  -H "Content-Type: application/json" \
  -d '{"voice":"af_heart","input":"Hello, world."}' \
  --output stream.bin
```

## Endpoints

### `GET /api/v1/audio/voices`

List available voices.

**Response** — `200 application/json`

```json
{
  "voices": [
    { "id": "af_heart", "name": "Heart", "lang": "en-us", "engine": "kokoro" },
    { "id": "bf_emma", "name": "Emma", "lang": "en-gb", "engine": "kokoro" }
  ]
}
```

For the naming convention (`af_`, `bm_`, `zf_`, …), see [`voices.md`](./voices.md).

---

### `POST /api/v1/audio/speech`

Generate the full audio file and return it in one response. Simpler but higher first-byte latency than the streaming variant.

**Request body** — `application/json`

| Field             | Type   | Default | Notes                                                  |
| ----------------- | ------ | ------- | ------------------------------------------------------ |
| `voice`           | string | —       | Voice ID or [mixing formula](./voices.md#voice-mixing) |
| `input`           | string | —       | Text to speak                                          |
| `speed`           | number | `1`     | Playback multiplier, `0.5`–`2.0`                       |
| `response_format` | string | `wav`   | `wav` or `mp3`                                         |

**Response** — `200 audio/wav` (or `audio/mpeg` for MP3)

---

### `POST /api/v1/audio/speech/stream`

Streaming generation. Returns chunked binary data with a 12-byte frame header per chunk.

**Request body** — same shape as `/audio/speech` (`response_format` ignored; WAV only).

**Response** — `200 application/octet-stream`, `Transfer-Encoding: chunked`.

**Frame layout per chunk:**

| Bytes | Meaning                     |
| ----- | --------------------------- |
| 0–3   | chunk index (uint32 LE)     |
| 4–7   | total chunks (uint32 LE)    |
| 8–11  | WAV data length (uint32 LE) |
| 12+   | WAV audio bytes             |

Chunks arrive at generation rate, so clients can start playback before the full utterance is ready.

---

### `GET /api/v1/settings`

Return the shared settings syncing between the app and extensions.

**Response** — `200 application/json`

```json
{
  "text": "",
  "language": "en-us",
  "voice": "af_heart",
  "volume": 80,
  "highlightChunk": true
}
```

---

### `POST /api/v1/settings`

Update the shared settings. Accepts a partial object — omitted fields stay as-is.

**Request body**

```json
{ "voice": "bf_emma", "volume": 65 }
```

**Response** — `200 application/json` (the merged settings).

---

### `GET /api/v1/openapi.yaml`

Serves this API's OpenAPI 3.1 spec at runtime.

```bash
curl http://127.0.0.1:51730/api/v1/openapi.yaml > openapi.yaml
```

## OpenAPI spec

The machine-readable spec lives at [`openapi.yaml`](./openapi.yaml). Load it in any OpenAPI viewer:

- Paste into [editor.swagger.io](https://editor.swagger.io/)
- Paste into [Stoplight Elements](https://elements.stoplight.io/)
- Import into Postman / Insomnia / Bruno

## See also

- [`architecture.md`](./architecture.md) — how the app is wired (HTTP server sits in the main process)
- [`voices.md`](./voices.md) — voice catalog + mixing formulas
- [`../extensions/testing.md`](../extensions/testing.md) — how the extensions consume this API
