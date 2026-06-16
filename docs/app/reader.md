# Document / Ebook Reader

The reader turns Out Loud from a "type and speak" utility into a document
reader that can read whole books aloud (TXT, EPUB, PDF) with synchronized
highlighting, auto-scroll, chapter/page navigation, and an adaptive sidebar.

It is an **in-place mode**: the existing quick-speak window stays the default;
opening a document grows the window and swaps to the reader layout.

## Why a new pipeline

The original TTS path (`tts:stream:start` → worker `generate`) generates the
entire input at once and holds all of it in RAM: the worker keeps every chunk
in `results[]` and concatenates one giant `finalWaveform`
(`electron/tts-worker.ts`), and the renderer keeps every decoded `AudioBuffer`
forever (`cachedAudioBuffersRef` in `useAudioPlayer.ts`). That is fine for a
paragraph and fatal for a book. There is also no cancellation, and streaming
speed is silently broken (the worker only applies speed to the final
concatenated buffer, which the streaming path never uses).

The reader adds a **parallel, bounded-memory pipeline** and leaves the
quick-speak path untouched.

## Two principles

1. **The sentence is the atomic unit** for TTS, highlight, scroll, and seek.
   Blocks (paragraphs/headings) are render containers holding sentences.
2. **Main stays stateless about document content.** The renderer owns parsing
   and the parsed document, and sends the unit texts to generate. Main is only:
   file dialog + byte reads + worker bridge + window resize + recents. A book
   never touches the settings / extension-sync path.

All three formats are parsed **in the renderer** — the renderer has a native
`DOMParser`, and `jszip`/`pdfjs` both run there — so the contract is uniform and
the main process needs no parser dependencies (and no native canvas).

## Architecture

```
Quick-speak (unchanged):  worker `generate`  ── today's pipeline

Reader:
 Open file ─► (MAIN reads bytes) ─► parseDocument() ─► NormalizedDoc{ blocks, sentences, chapters, pages }
   TXT (TextDecoder) · EPUB (jszip + DOMParser) · PDF (pdfjs)   — all in the RENDERER
                       │
 ReaderView ── useReaderPlayer (windowed engine) ──► reader:generate(units[])
   ├ Sidebar (adaptive)                          MAIN bridge ──► worker `generateUnits`
   ├ ReaderPane (highlight + auto-scroll, seek)         ◄── reader:unitChunk{ unitId, wav }
   └ ReaderControls (play, speed, voice, progress)
```

## Data model

Declared in `electron-ui/src/reader/types.ts`.

```ts
interface DocSentence {
  id: string;
  text: string;
}
interface DocBlock {
  id: string;
  kind: "para" | "heading";
  level?: number;
  chapterIndex: number;
  pageIndex?: number;
  sentences: DocSentence[];
}
interface DocChapter {
  id: string;
  title: string;
  blockStart: number;
  blockEnd: number;
}
interface DocPage {
  id: string;
  index: number;
  label: string;
  kind: "pdf" | "synthetic" | "chapter";
  blockStart: number;
  blockEnd: number;
}
interface NormalizedDoc {
  id: string;
  title: string;
  format: "txt" | "epub" | "pdf";
  blocks: DocBlock[];
  chapters: DocChapter[];
  pages: DocPage[];
  sourcePath?: string;
}
```

The flat ordered list of sentences (derived from `blocks`) is the playback
stream. Sentence splitting uses `Intl.Segmenter(lang, {granularity:"sentence"})`
(Node 22 + Chromium) with a regex fallback, so boundaries are identical in
every parser via one canonical `segment.ts`.

## Worker protocol (the highlight-alignment fix)

`electron/tts-worker.ts` gains a `generateUnits` message (the existing
`generate` is untouched):

- Input `{ requestId, units:[{id,text}], voiceFormula, lang, acceleration }`.
- For each unit in order: reuse `preprocessText` → `processChunk` look-ahead →
  emit `chunk` tagged with `unitId` (a long unit may sub-chunk; every chunk
  carries the same `unitId`), then `unitDone{unitId}`.
- Per-request cancellation: a `cancel{requestId}` message marks the request
  aborted; the loop checks before each unit / inference / yield and emits
  `aborted{requestId}`.

Because every audio chunk carries its `unitId`, the renderer highlights by id
and never re-derives chunk boundaries — eliminating the fragile
`splitIntoChunks` duplication and the sub-chunking drift that would bite long /
under-punctuated text.

## Windowed engine (`useReaderPlayer.ts`)

- **Look-ahead buffering:** keep ~`TARGET_AHEAD_SEC` (40s) of audio ahead of the
  playhead, requested in `BATCH_UNITS` (10) batches; only one batch is in flight
  at a time (next requested on the prior `genComplete` or when the buffer drops
  below target). Memory stays bounded regardless of document size.
- **Eviction:** chunks are pruned ~`PRUNE_BEHIND_SEC` (2s) behind the playhead;
  backward seeks simply re-generate. This is what makes a whole book survivable.
- **In-order decode:** chunks pass through a single decode queue so
  `decodeAudioData` resolving out of order can't scramble the timeline.
- **Seek** (sentence click / sidebar / chapter): cancel in-flight generation,
  stop scheduled sources, and restart generation/playback at the target unit.
- **Speed:** Web Audio `playbackRate` (no re-gen; pitch rises in v1). Timeline
  math divides durations by speed; speed changes re-anchor scheduling.
- **Highlight + scroll:** the rAF loop maps `currentTime → unitId`; ReaderPane
  highlights that sentence and auto-scrolls (pausing on manual scroll).

The reader currently runs CPU inference (the ONNX session is shared with
quick-speak, avoiding session thrash). **CoreML on macOS** is the first tuning
lever if generation can't keep up with playback — `readerGenerate` in `main.ts`
already passes an `acceleration` field.

## Files

### Main

- `electron/reader-recents.ts` — `userData/reader-recents.json` (path + position
  only). Flat file (the electron tsconfig only globs `electron/*.ts`).

Modified: `electron/tts-worker.ts` (`generateUnits` + `cancel` + per-request
abort), `electron/main.ts` (reader IPC, worker bridge, window resize),
`electron/preload.cjs` (**the loaded file** — add `reader.*`), plus
`electron/preload.ts` and `electron-ui/src/electron.d.ts` (typings).

### Renderer (`electron-ui/src/reader/`)

- `types.ts`, `model.ts` (finalize + flatten), `segment.ts` (sentence splitter)
- `parsers/{shared,txt,epub,pdf,pdfSetup}.ts`, `parseDocument.ts`, `pdfRender.ts`
- `useReaderDoc.ts`, `useReaderPlayer.ts`, `useAutoScroll.ts`
- `ReaderView.tsx`, `Sidebar.tsx`, `ReaderPane.tsx`, `ReaderControls.tsx`

Modified: `App.tsx` (mode toggle + open entry), `electron.d.ts`,
`components/VoiceSelect.tsx` (export `VOICES`/`LANGUAGES` for the compact picker).

### Dependencies

- Renderer: `pdfjs-dist`, `jszip` (+ the native `DOMParser`). Main: none new.
- All pure-JS → ship inside asar; no `asarUnpack` changes. PDF parsing and
  thumbnail rendering both stay in the renderer (no native canvas in main).

## Adaptive sidebar

- **PDF** → real page thumbnails (lazy / virtualized).
- **EPUB** → chapter / TOC list.
- **TXT** → synthetic page cards.

## Per-format notes

- **TXT**: paragraphs by blank line; synthetic pages by length; heading
  heuristics ("Chapter N", short ALL-CAPS lines).
- **EPUB**: spine = order, nav/ncx = chapters; DRM detected → friendly error.
- **PDF**: native pages; `getOutline` → chapters; scanned PDFs (no text layer)
  detected → warn (OCR out of scope).

## Phasing

0. Model + segmenter + types.
1. Import + parse all three + static reader (no audio): dialog/drag, parsers,
   ReaderView/Sidebar/ReaderPane, in-place resize, click-to-scroll, recents.
2. Windowed audio engine: `generateUnits`+cancel, `engine.ts`,
   `useReaderPlayer`, highlight + auto-scroll. **The crux.**
3. Polish: speed, click-to-seek, chapter nav, PDF thumbnails, a11y, empty /
   scanned / DRM states.
4. Hardening: eviction tuning, large-book stress, optional pitch-preserving
   speed, per-chapter export.

## Risks

- **Generation keeping up with playback** — measure throughput, CoreML on mac,
  tune look-ahead, prefetch next chapter.
- **Memory on full books** — bounded buffer + eviction (validate on a novel).
- **pdfjs-in-Electron** — pin version, handle worker asset in Vite, detect
  scanned PDFs.
- **Build detail** — `preload.cjs` is hand-maintained (no generator); edit it
  directly.
