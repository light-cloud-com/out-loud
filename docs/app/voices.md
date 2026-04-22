# Voices

Out Loud ships with 50+ Kokoro voices across 8 languages. This page documents the naming convention and voice-mixing formula syntax.

## Contents

- [Naming convention](#naming-convention)
- [Language catalog](#language-catalog)
- [Voice mixing](#voice-mixing)
- [Adding a new voice](#adding-a-new-voice)
- [See also](#see-also)

## Naming convention

Voice IDs follow the pattern `{lang-prefix}{gender}_{name}`:

```
af_heart
│││
││└── voice name (lowercase)
│└─── gender: `f` female · `m` male
└──── language prefix (see below)
```

## Language catalog

| Prefix        | Language           | Voice count | Examples                   |
| ------------- | ------------------ | ----------- | -------------------------- |
| `af_` / `am_` | English (US)       | 20          | `af_heart`, `am_michael`   |
| `bf_` / `bm_` | English (UK)       | 8           | `bf_emma`, `bm_george`     |
| `ef_` / `em_` | Spanish            | 3           | `ef_dora`                  |
| `pf_` / `pm_` | Portuguese (BR)    | 3           | `pf_dora`                  |
| `if_` / `im_` | Italian            | 2           | `if_sara`, `im_nicola`     |
| `hf_` / `hm_` | Hindi              | 4           | `hf_alpha`, `hm_omega`     |
| `jf_` / `jm_` | Japanese           | 5           | `jf_alpha`, `jm_kumo`      |
| `zf_` / `zm_` | Chinese (Mandarin) | 8           | `zf_xiaobei`, `zm_yunjian` |

The canonical list lives in [`electron-ui/src/components/VoiceSelect.tsx`](../../electron-ui/src/components/VoiceSelect.tsx).

## Voice mixing

You can blend voices with a simple formula in the `voice` field of any speech endpoint:

```
af_bella*0.7 + af_sarah*0.3
```

**Rules:**

- Each term is `{voice_id}*{weight}`
- Weights must be in `[0, 1]` at one-decimal precision
- All weights must sum to exactly `1`
- Whitespace is ignored
- A single voice ID without `*weight` is treated as weight `1`

**Examples:**

| Formula                                | Result          |
| -------------------------------------- | --------------- |
| `af_heart`                             | 100% Heart      |
| `af_heart*0.5+af_bella*0.5`            | 50/50 blend     |
| `af_heart*0.4+af_bella*0.3+af_sky*0.3` | three-way blend |

Mixing works by weighted-averaging the voices' embedding vectors before inference. All voices in a formula must belong to the same language prefix — mixing across languages yields unusable output.

## Adding a new voice

1. Drop the voice `.bin` file into `electron/models/`
2. Register the voice metadata in [`electron-ui/src/components/VoiceSelect.tsx`](../../electron-ui/src/components/VoiceSelect.tsx) (id, name, language)
3. Register the language prefix mapping in [`electron/main.ts`](../../electron/main.ts) (`getVoiceLang`)
4. Add the voice entry to `getVoicesList()` in `electron/main.ts` so the HTTP API exposes it

For new languages, `espeak-ng` must support the language too — check the bundled language codes.

## See also

- [`api.md`](./api.md) — endpoints that accept voice IDs and formulas
- [`architecture.md`](./architecture.md) — where voice selection happens (TTS worker)
