import { parentPort } from "worker_threads";
import * as ort from "onnxruntime-node";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ESpeakNg from "espeak-ng";
import { createWavBuffer } from "./shared-audio.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve a path that may live inside app.asar to its real on-disk location
// under app.asar.unpacked. Always prefer the unpacked variant when it exists,
// because Electron's asar interception lets fs.readFile see asar-internal
// files, but child_process.spawn (used by fluent-ffmpeg) bypasses asar and
// can only execute real files on disk. Returning the unpacked path works
// transparently for both cases.
function resolveUnpacked(p) {
    if (!p)
        return null;
    if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
        const unpacked = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
        if (existsSync(unpacked))
            return unpacked;
        // Fallback for path separator mismatches across platforms.
        const unpackedAlt = p.replace("app.asar", "app.asar.unpacked");
        if (existsSync(unpackedAlt))
            return unpackedAlt;
    }
    if (existsSync(p))
        return p;
    return p;
}
// Set ffmpeg path for fluent-ffmpeg
const resolvedFfmpegPath = resolveUnpacked(ffmpegPath);
if (resolvedFfmpegPath) {
    ffmpeg.setFfmpegPath(resolvedFfmpegPath);
    console.log("[TTS Worker] ffmpeg path:", resolvedFfmpegPath);
}
else {
    console.warn("[TTS Worker] ffmpeg-static binary not found; speed != 1 and mp3 export will fail");
}
const MODEL_CONTEXT_WINDOW = 512;
const SAMPLE_RATE = 24000;
// Look-ahead sizes per acceleration mode for streaming processing
const LOOK_AHEAD_SIZES = {
    cpu: 4,
    coreml: 3,
};
// Models directory - embedded in the app, asarUnpack'd by electron-builder.
const MODELS_DIR = resolveUnpacked(path.join(__dirname, "models")) ?? path.join(__dirname, "models");
const isPackaged = __dirname.includes("app.asar");
console.log("[TTS Worker] __dirname:", __dirname);
console.log("[TTS Worker] isPackaged:", isPackaged);
console.log("[TTS Worker] MODELS_DIR:", MODELS_DIR);
// Keep ONNX session alive between requests for performance
let cachedSession = null;
let cachedModelId = null;
// Current request ID for progress messages
let currentRequestId = null;
// Shutdown flag to abort ongoing work
let isShuttingDown = false;
// Per-request cancellation for the reader's windowed generation. Main adds a
// requestId here via a `cancel` message; the generateUnits loop checks it
// between units / inferences / yields and stops promptly.
const abortedRequests = new Set();
// Tokenizer vocab - all keys must be properly quoted strings
const vocab = {
    ";": 1,
    ":": 2,
    ",": 3,
    ".": 4,
    "!": 5,
    "?": 6,
    "\u2014": 9, // —
    "\u2026": 10, // …
    '"': 11,
    "(": 12,
    ")": 13,
    "\u201C": 14, // "
    "\u201D": 15, // "
    " ": 16,
    "\u0303": 17,
    "\u02A3": 18, // ʣ
    "\u02A5": 19, // ʥ
    "\u02A6": 20, // ʦ
    "\u02A8": 21, // ʨ
    "\u1D5D": 22, // ᵝ
    "\uAB67": 23,
    A: 24,
    I: 25,
    O: 31,
    Q: 33,
    S: 35,
    T: 36,
    W: 39,
    Y: 41,
    "\u1D4A": 42, // ᵊ
    a: 43,
    b: 44,
    c: 45,
    d: 46,
    e: 47,
    f: 48,
    h: 50,
    i: 51,
    j: 52,
    k: 53,
    l: 54,
    m: 55,
    n: 56,
    o: 57,
    p: 58,
    q: 59,
    r: 60,
    s: 61,
    t: 62,
    u: 63,
    v: 64,
    w: 65,
    x: 66,
    y: 67,
    z: 68,
    "\u0251": 69, // ɑ
    "\u0250": 70, // ɐ
    "\u0252": 71, // ɒ
    "\u00E6": 72, // æ
    "\u03B2": 75, // β
    "\u0254": 76, // ɔ
    "\u0255": 77, // ɕ
    "\u00E7": 78, // ç
    "\u0256": 80, // ɖ
    "\u00F0": 81, // ð
    "\u02A4": 82, // ʤ
    "\u0259": 83, // ə
    "\u025A": 85, // ɚ
    "\u025B": 86, // ɛ
    "\u025C": 87, // ɜ
    "\u025F": 90, // ɟ
    "\u0261": 92, // ɡ
    "\u0265": 99, // ɥ
    "\u0268": 101, // ɨ
    "\u026A": 102, // ɪ
    "\u029D": 103, // ʝ
    "\u026F": 110, // ɯ
    "\u0270": 111, // ɰ
    "\u014B": 112, // ŋ
    "\u0273": 113, // ɳ
    "\u0272": 114, // ɲ
    "\u0274": 115, // ɴ
    "\u00F8": 116, // ø
    "\u0278": 118, // ɸ
    "\u03B8": 119, // θ
    "\u0153": 120, // œ
    "\u0279": 123, // ɹ
    "\u027E": 125, // ɾ
    "\u027B": 126, // ɻ
    "\u0281": 128, // ʁ
    "\u027D": 129, // ɽ
    "\u0282": 130, // ʂ
    "\u0283": 131, // ʃ
    "\u0288": 132, // ʈ
    "\u02A7": 133, // ʧ
    "\u028A": 135, // ʊ
    "\u028B": 136, // ʋ
    "\u028C": 138, // ʌ
    "\u0263": 139, // ɣ
    "\u0264": 140, // ɤ
    "\u03C7": 142, // χ
    "\u028E": 143, // ʎ
    "\u0292": 147, // ʒ
    "\u0294": 148, // ʔ
    "\u02C8": 156, // ˈ
    "\u02CC": 157, // ˌ
    "\u02D0": 158, // ː
    "\u02B0": 162, // ʰ
    "\u02B2": 164, // ʲ
    "\u2193": 169, // ↓
    "\u2192": 171, // →
    "\u2197": 172, // ↗
    "\u2198": 173, // ↘
    "\u1D7B": 177, // ᵻ
};
// Language mapping for espeak-ng
const langsMap = {
    "en-us": "en-us",
    "en-gb": "en-gb",
    ja: "ja",
    cmn: "cmn",
    "es-419": "es-419",
    hi: "hi",
    it: "it",
    "pt-br": "pt-br",
};
function tokenize(phonemes) {
    const fallback_char = 16;
    return [...phonemes].map((char) => vocab[char] || fallback_char);
}
async function getModel(_id) {
    // Only model_q8f16 is embedded
    const modelPath = path.join(MODELS_DIR, "model_q8f16.onnx");
    const data = await fs.readFile(modelPath);
    console.log("Loaded embedded model:", modelPath);
    return new Uint8Array(data).buffer;
}
async function getVoiceFile(id) {
    const voicePath = path.join(MODELS_DIR, `${id}.bin`);
    const data = await fs.readFile(voicePath);
    console.log("Loaded embedded voice:", voicePath);
    return new Uint8Array(data).buffer;
}
async function getShapedVoiceFile(id) {
    const voice = await getVoiceFile(id);
    const voiceArray = new Float32Array(voice);
    const voiceArrayLen = voiceArray.length;
    const reshaped = [];
    for (let from = 0; from < voiceArray.length; from += 256) {
        const to = Math.min(from + 256, voiceArrayLen);
        const chunk = Array.from(voiceArray.slice(from, to));
        reshaped.push([chunk]);
    }
    return reshaped;
}
function parseVoiceFormula(formula) {
    formula = formula.replace(/\s+/g, "");
    if (formula === "") {
        throw new Error("Voice or voice formula cannot be empty");
    }
    const allowedChars = /^[A-Za-z0-9\-_.*+]+$/;
    if (!allowedChars.test(formula)) {
        throw new Error("Invalid formula characters");
    }
    const terms = formula.split("+").filter((term) => term !== "");
    if (terms.length === 1 && !terms[0].includes("*")) {
        return [{ voiceId: terms[0], weight: 1 }];
    }
    const voices = [];
    for (const term of terms) {
        if (!term.includes("*")) {
            throw new Error(`Term "${term}" must contain asterisk`);
        }
        const parts = term.split("*");
        if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
            throw new Error(`Term "${term}" format incorrect`);
        }
        const voiceId = parts[0];
        let weight = parseFloat(parts[1]);
        if (isNaN(weight) || weight < 0 || weight > 1) {
            throw new Error(`Invalid weight for voice "${voiceId}"`);
        }
        weight = Math.round(weight * 10) / 10;
        voices.push({ voiceId, weight });
    }
    const totalWeight = voices.reduce((sum, v) => sum + v.weight, 0);
    if (Math.round(totalWeight * 10) / 10 !== 1) {
        throw new Error(`Weights must sum to 1, got ${totalWeight}`);
    }
    return voices;
}
async function combineVoices(voices) {
    if (voices.length === 0) {
        throw new Error("You must select at least one voice");
    }
    const voiceArrays = await Promise.all(voices.map((v) => getShapedVoiceFile(v.voiceId)));
    const baseChunks = voiceArrays[0].length;
    const baseInner = voiceArrays[0][0].length;
    const baseLength = voiceArrays[0][0][0].length;
    const combinedVoice = [];
    for (let i = 0; i < baseChunks; i++) {
        combinedVoice[i] = [];
        for (let j = 0; j < baseInner; j++) {
            combinedVoice[i][j] = new Array(baseLength).fill(0);
        }
    }
    for (let v = 0; v < voiceArrays.length; v++) {
        const weight = voices[v].weight;
        const voice = voiceArrays[v];
        for (let i = 0; i < baseChunks; i++) {
            for (let j = 0; j < baseInner; j++) {
                for (let k = 0; k < baseLength; k++) {
                    combinedVoice[i][j][k] += weight * voice[i][j][k];
                }
            }
        }
    }
    return combinedVoice;
}
function normalizeText(text) {
    return text
        .replaceAll("\u2018", "'") // '
        .replaceAll("\u2019", "'") // '
        .replaceAll("\u00AB", "(") // «
        .replaceAll("\u00BB", ")") // »
        .replaceAll("\u201C", '"') // "
        .replaceAll("\u201D", '"') // "
        .replace(/\u3001/g, ", ") // 、
        .replace(/\u3002/g, ". ") // 。
        .replace(/\uFF01/g, "! ") // ！
        .replace(/\uFF0C/g, ", ") // ，
        .replace(/\uFF1A/g, ": ") // ：
        .replace(/\uFF1B/g, "; ") // ；
        .replace(/\uFF1F/g, "? ") // ？
        .replaceAll("\n", "  ")
        .replaceAll("\t", "  ")
        .trim();
}
async function phonemize(text, langId) {
    const lang = langsMap[langId] || "en-us";
    text = normalizeText(text);
    const espeakArgs = ["--phonout", "generated", "-q", "--ipa", "-v", lang, text];
    const espeak = await ESpeakNg({
        arguments: espeakArgs,
    });
    const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
    return generated.split("\n").join(" ").trim();
}
// Normalize the user-facing pause syntaxes into the canonical [Ns] marker that
// the rest of the pipeline understands. Accepts:
//   <pause=1s> / <pause=500ms> / <pause=1>      (the friendly tag)
//   <break time="1s"/> / <break time='500ms'>   (SSML-style)
//   [500ms] / [1 s] / [1S] / [1s]               (forgiving bracket form)
// Everything collapses to seconds, e.g. [1s], [0.5s].
function normalizePauseTags(text) {
    const toMarker = (value, unit) => {
        const seconds = unit && unit.toLowerCase() === "ms" ? parseFloat(value) / 1000 : parseFloat(value);
        return `[${seconds}s]`;
    };
    return text
        .replace(/<\s*pause\s*=\s*"?([0-9]*\.?[0-9]+)\s*(ms|s)?"?\s*\/?\s*>/gi, (_, n, u) => toMarker(n, u))
        .replace(/<\s*break\s+time\s*=\s*["']?([0-9]*\.?[0-9]+)\s*(ms|s)?["']?\s*\/?\s*>/gi, (_, n, u) => toMarker(n, u))
        .replace(/\[\s*([0-9]*\.?[0-9]+)\s*(ms|s)\s*\]/gi, (_, n, u) => toMarker(n, u));
}
function sanitizeText(rawText) {
    return (normalizePauseTags(rawText)
        // Ellipsis (… or 3+ dots) → a longer, trailing-off pause. MUST run before
        // the single-period rule, otherwise "..." would be half-consumed.
        .replace(/\s*(?:…|\.{3,})\s*/g, "[0.5s]")
        // Em-dash — always a break, whether spaced ("a — b") or tight ("a—b").
        .replace(/\s*—\s*/g, "[0.3s]")
        // En-dash / hyphen used as a dash: only when spaced on BOTH sides, so
        // number ranges ("5–10") and compound words ("well-known") are untouched.
        .replace(/\s+[–-]\s+/g, "[0.3s]")
        .replace(/\.\s+/g, "[0.4s]")
        .replace(/,\s+/g, "[0.2s]")
        .replace(/;\s+/g, "[0.4s]")
        .replace(/:\s+/g, "[0.3s]")
        .replace(/!\s+/g, "![0.1s]")
        .replace(/\?\s+/g, "?[0.1s]")
        .replace(/\n+/g, "[0.4s]")
        .trim());
}
function segmentText(sanitizedText) {
    const regex = /(\[[0-9]+(?:\.[0-9]+)?s\])/g;
    return sanitizedText
        .split(regex)
        .map((s) => s.trim())
        .filter((s) => s !== "");
}
function isSilenceMarker(segment) {
    return /^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment.trim());
}
function extractSilenceDuration(marker) {
    const match = marker.trim().match(/^\[([0-9]+(?:\.[0-9]+)?)s\]$/);
    return match ? parseFloat(match[1]) : 0;
}
function createPhonemeSubChunks(phonemes, tokensPerChunk) {
    if (phonemes.length <= tokensPerChunk)
        return [phonemes];
    const chunks = [];
    let currentChunk = "";
    for (const phoneme of phonemes) {
        if (currentChunk.length >= tokensPerChunk) {
            chunks.push(currentChunk);
            currentChunk = "";
        }
        currentChunk += phoneme;
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}
async function preprocessText(text, lang, tokensPerChunk) {
    const chunks = [];
    const sanitized = sanitizeText(text);
    const segments = segmentText(sanitized);
    for (const segment of segments) {
        if (isSilenceMarker(segment)) {
            const durationSeconds = extractSilenceDuration(segment);
            chunks.push({ type: "silence", durationSeconds });
            continue;
        }
        const phonemized = await phonemize(segment, lang);
        const phonemizedChunks = createPhonemeSubChunks(phonemized, tokensPerChunk);
        for (const phonemeChunk of phonemizedChunks) {
            const tokens = tokenize(phonemeChunk);
            chunks.push({ type: "text", content: phonemeChunk, tokens });
        }
    }
    return chunks;
}
function trimWaveform(waveform) {
    const windowSize = 256;
    const bufferSamples = 256;
    const numWindows = Math.ceil(waveform.length / windowSize);
    const windowAmplitudes = new Float32Array(numWindows);
    let maxWindowAmp = 0;
    for (let i = 0; i < numWindows; i++) {
        const start = i * windowSize;
        const end = Math.min(start + windowSize, waveform.length);
        let sum = 0;
        for (let j = start; j < end; j++) {
            sum += Math.abs(waveform[j]);
        }
        const avg = sum / (end - start);
        windowAmplitudes[i] = avg;
        if (avg > maxWindowAmp)
            maxWindowAmp = avg;
    }
    const threshold = maxWindowAmp * 0.05;
    let startSample = 0;
    for (let i = 0; i < numWindows; i++) {
        if (windowAmplitudes[i] > threshold) {
            const winStart = i * windowSize;
            const winEnd = Math.min(winStart + windowSize, waveform.length);
            for (let j = winStart; j < winEnd; j++) {
                if (Math.abs(waveform[j]) > threshold) {
                    startSample = j;
                    break;
                }
            }
            break;
        }
    }
    let endSample = waveform.length;
    for (let i = numWindows - 1; i >= 0; i--) {
        if (windowAmplitudes[i] > threshold) {
            const winStart = i * windowSize;
            const winEnd = Math.min(winStart + windowSize, waveform.length);
            for (let j = winEnd - 1; j >= winStart; j--) {
                if (Math.abs(waveform[j]) > threshold) {
                    endSample = j + 1;
                    break;
                }
            }
            break;
        }
    }
    startSample = Math.max(0, startSample - bufferSamples);
    endSample = Math.min(waveform.length, endSample + bufferSamples);
    return waveform.slice(startSample, endSample);
}
// createWavBuffer, buildAtempoChain, modifyWavSpeed, wavToMp3 are imported from shared-audio.ts
// Get or create the ONNX session, reusing the module-level cache (shared with
// generateVoice) when the model matches.
async function ensureSession(model, acceleration) {
    if (cachedSession && cachedModelId === model)
        return cachedSession;
    const modelBuffer = await getModel(model);
    const executionProviders = [];
    if (acceleration === "coreml")
        executionProviders.push("coreml");
    executionProviders.push("cpu");
    const session = await ort.InferenceSession.create(Buffer.from(modelBuffer), {
        executionProviders,
    });
    cachedSession = session;
    cachedModelId = model;
    return session;
}
function buildUnits(text) {
    const segments = segmentText(sanitizeText(text));
    const units = [];
    for (const segment of segments) {
        if (isSilenceMarker(segment)) {
            units.push({
                type: "silence",
                silenceLength: Math.floor(extractSilenceDuration(segment) * SAMPLE_RATE),
            });
        }
        else {
            units.push({ type: "text", segment });
        }
    }
    return units;
}
// ---- Quick-speak generation flow control (backpressure) ----
// The renderer caps how far ahead we generate ("genTarget" = highest chunk
// index that may START) so a paused/idle ebook doesn't generate the whole book.
// Renderer is the single source of truth: it advances genTarget as playback
// moves (currentChunk + ~20), re-caps it to stop, or sets it to Infinity on
// Download (full export). Backpressure is OPT-IN: callers that don't pass
// initialTarget (e.g. the Chrome-extension HTTP API) generate fully, unchanged.
let activeGenerateId = null;
let genTarget = Number.MAX_SAFE_INTEGER;
let genWake = null;
function wakeGen() {
    const w = genWake;
    genWake = null;
    if (w)
        w();
}
async function generateVoice(params) {
    if (params.speed < 0.1 || params.speed > 5) {
        throw new Error("Speed must be between 0.1 and 5");
    }
    const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
    // Split into units up front (cheap regex only); phonemize lazily while streaming.
    const units = buildUnits(params.text);
    // Get or create ONNX session
    let session;
    if (cachedSession && cachedModelId === params.model) {
        session = cachedSession;
    }
    else {
        const modelBuffer = await getModel(params.model);
        // Configure execution providers for GPU acceleration
        const executionProviders = [];
        if (params.acceleration === "coreml") {
            executionProviders.push("coreml");
        }
        executionProviders.push("cpu");
        session = await ort.InferenceSession.create(Buffer.from(modelBuffer), {
            executionProviders,
        });
        cachedSession = session;
        cachedModelId = params.model;
    }
    const voices = parseVoiceFormula(params.voiceFormula);
    const combinedVoice = await combineVoices(voices);
    const lookAhead = LOOK_AHEAD_SIZES[params.acceleration] || 3;
    const totalChunks = units.length;
    if (totalChunks === 0) {
        throw new Error("No chunks to process");
    }
    // Results array and tracking. Each entry is freed (set null) once emitted so
    // we never hold the whole-document audio in memory.
    const results = new Array(totalChunks);
    const completed = new Array(totalChunks).fill(false);
    let nextToYield = 0;
    let nextToStart = 0;
    let completedCount = 0;
    // In-flight promises
    const inFlight = new Map();
    // Process one unit. Silence -> a zero buffer. Text -> phonemize NOW (this is the
    // work moved off the startup path), then run inference for each sub-chunk of a
    // long segment and concatenate them into a single waveform for this unit.
    const processChunk = async (chunkIdx) => {
        const unit = units[chunkIdx];
        if (unit.type === "silence") {
            return { index: chunkIdx, waveform: new Float32Array(unit.silenceLength) };
        }
        const phonemized = await phonemize(unit.segment, params.lang);
        const parts = [];
        for (const phonemeChunk of createPhonemeSubChunks(phonemized, tokensPerChunk)) {
            const tokens = tokenize(phonemeChunk);
            if (tokens.length < 1)
                continue;
            const ref_s = combinedVoice[tokens.length - 1][0];
            const paddedTokens = [0, ...tokens, 0];
            const input_ids = new ort.Tensor("int64", BigInt64Array.from(paddedTokens.map(BigInt)), [
                1,
                paddedTokens.length,
            ]);
            const style = new ort.Tensor("float32", new Float32Array(ref_s), [1, ref_s.length]);
            const speed = new ort.Tensor("float32", [1], [1]);
            const result = await session.run({ input_ids, style, speed });
            parts.push(trimWaveform(result.waveform.data));
        }
        if (parts.length === 0)
            return { index: chunkIdx, waveform: new Float32Array(0) };
        if (parts.length === 1)
            return { index: chunkIdx, waveform: parts[0] };
        const len = parts.reduce((sum, p) => sum + p.length, 0);
        const waveform = new Float32Array(len);
        let off = 0;
        for (const p of parts) {
            waveform.set(p, off);
            off += p.length;
        }
        return { index: chunkIdx, waveform };
    };
    // Capture THIS run's id + abort check once. Everything below uses reqId, not
    // the mutable module-global currentRequestId, so a superseded/overlapping run
    // can't mis-tag this run's chunks (or vice-versa) when a new generate arrives
    // while this run's in-flight ONNX inference is still settling.
    const reqId = currentRequestId;
    const isAborted = () => isShuttingDown || (reqId !== null && abortedRequests.has(reqId));
    // Yield consecutive completed chunks in order
    const yieldReadyChunks = () => {
        while (nextToYield < totalChunks && completed[nextToYield]) {
            // Send chunk ready via IPC for streaming playback
            const waveform = results[nextToYield];
            const wavBuffer = createWavBuffer(waveform, SAMPLE_RATE);
            const base64 = Buffer.from(wavBuffer).toString("base64");
            parentPort?.postMessage({
                requestId: reqId,
                type: "chunk",
                data: {
                    chunkIndex: nextToYield,
                    totalChunks,
                    base64,
                    mimeType: "audio/wav",
                },
            });
            results[nextToYield] = null; // free after emit — bounds memory on large docs
            nextToYield++;
        }
    };
    // Fill look-ahead window — but never START a chunk beyond genTarget (the
    // renderer's buffer-ahead cap), so we don't generate the whole document.
    const fillLookAhead = () => {
        if (isAborted())
            return;
        while (inFlight.size < lookAhead && nextToStart < totalChunks && nextToStart <= genTarget) {
            const chunkIdx = nextToStart;
            nextToStart++;
            const promise = processChunk(chunkIdx);
            inFlight.set(chunkIdx, promise);
            promise.then((result) => {
                inFlight.delete(result.index);
                // If this run was superseded/aborted, stop emitting (its in-flight tail
                // must not post progress/chunks tagged onto whatever runs next).
                if (isAborted())
                    return;
                results[result.index] = result.waveform;
                completed[result.index] = true;
                completedCount++;
                // Report progress
                parentPort?.postMessage({
                    requestId: reqId,
                    type: "progress",
                    data: {
                        stage: "inference",
                        completed: completedCount,
                        total: totalChunks,
                        percent: Math.round((completedCount / totalChunks) * 100),
                    },
                });
                // Yield any chunks that are ready (in order)
                yieldReadyChunks();
                // Fill look-ahead with more work
                fillLookAhead();
            });
        }
    };
    // Drive the pipeline. When we've caught up to genTarget but the document isn't
    // finished, PARK on genWake (no busy-loop) until the renderer advances the
    // target (setTarget) or we're aborted/shut down — instead of ending early.
    while (completedCount < totalChunks) {
        if (isAborted()) {
            throw new Error("Generation aborted");
        }
        fillLookAhead();
        if (inFlight.size > 0) {
            await Promise.race(inFlight.values());
        }
        else if (nextToStart < totalChunks) {
            // Caught up to the buffer target — wait for it to advance (or for abort).
            await new Promise((resolve) => {
                genWake = resolve;
            });
        }
        else {
            break;
        }
    }
    // Final yield
    yieldReadyChunks();
    // Every chunk was streamed (and freed) above. We deliberately do NOT
    // accumulate/concatenate the whole-document waveform — for a book it would be
    // gigabytes, and no consumer uses this return value (all of them read the
    // per-chunk stream). Return a tiny empty buffer so the caller's promise
    // resolves and "tts:complete" fires.
    return { buffer: createWavBuffer(new Float32Array(0), SAMPLE_RATE), mimeType: "audio/wav" };
}
async function generateUnitsToStream(params, emit, isAborted) {
    const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
    const session = await ensureSession(params.model, params.acceleration);
    const combinedVoice = await combineVoices(parseVoiceFormula(params.voiceFormula));
    const lookAhead = LOOK_AHEAD_SIZES[params.acceleration] || 3;
    // Flatten all units into one ordered chunk list, tagged with unitId. A unit
    // that produces no audible chunks still gets a unitDone so the highlight can
    // advance past it.
    const prepared = [];
    for (const unit of params.units) {
        if (isAborted())
            return;
        const chunks = await preprocessText(unit.text, params.lang, tokensPerChunk);
        const unitChunks = [];
        for (const chunk of chunks) {
            if (chunk.type === "silence") {
                unitChunks.push({
                    type: "silence",
                    silenceLength: Math.floor(chunk.durationSeconds * SAMPLE_RATE),
                    unitId: unit.id,
                    isUnitEnd: false,
                });
            }
            else if (chunk.type === "text" && (chunk.tokens?.length ?? 0) >= 1) {
                unitChunks.push({ type: "text", tokens: chunk.tokens, unitId: unit.id, isUnitEnd: false });
            }
        }
        if (unitChunks.length === 0) {
            emit({ requestId: params.requestId, type: "unitDone", data: { unitId: unit.id } });
            continue;
        }
        unitChunks[unitChunks.length - 1].isUnitEnd = true;
        prepared.push(...unitChunks);
    }
    const total = prepared.length;
    if (total === 0) {
        emit({ requestId: params.requestId, type: "genComplete" });
        return;
    }
    const results = new Array(total).fill(null);
    const completed = new Array(total).fill(false);
    let nextToYield = 0;
    let nextToStart = 0;
    let completedCount = 0;
    const inFlight = new Map();
    const processChunk = async (idx) => {
        const pc = prepared[idx];
        if (pc.type === "silence") {
            return { index: idx, waveform: new Float32Array(pc.silenceLength) };
        }
        const tokens = pc.tokens;
        const ref_s = combinedVoice[tokens.length - 1][0];
        const paddedTokens = [0, ...tokens, 0];
        const input_ids = new ort.Tensor("int64", BigInt64Array.from(paddedTokens.map(BigInt)), [
            1,
            paddedTokens.length,
        ]);
        const style = new ort.Tensor("float32", new Float32Array(ref_s), [1, ref_s.length]);
        const speed = new ort.Tensor("float32", [1], [1]);
        const result = await session.run({ input_ids, style, speed });
        let waveform = result.waveform.data;
        waveform = trimWaveform(waveform);
        return { index: idx, waveform };
    };
    const yieldReady = () => {
        while (nextToYield < total && completed[nextToYield]) {
            const pc = prepared[nextToYield];
            const waveform = results[nextToYield];
            const wavBuffer = createWavBuffer(waveform, SAMPLE_RATE);
            const base64 = Buffer.from(wavBuffer).toString("base64");
            emit({
                requestId: params.requestId,
                type: "unitChunk",
                data: { unitId: pc.unitId, base64, mimeType: "audio/wav" },
            });
            if (pc.isUnitEnd) {
                emit({ requestId: params.requestId, type: "unitDone", data: { unitId: pc.unitId } });
            }
            results[nextToYield] = null; // free the waveform once emitted
            nextToYield++;
        }
    };
    const fill = () => {
        while (inFlight.size < lookAhead && nextToStart < total) {
            if (isAborted())
                return;
            const idx = nextToStart++;
            const promise = processChunk(idx);
            inFlight.set(idx, promise);
            promise.then((r) => {
                results[r.index] = r.waveform;
                completed[r.index] = true;
                completedCount++;
                inFlight.delete(r.index);
                yieldReady();
                if (!isAborted())
                    fill();
            });
        }
    };
    fill();
    while (completedCount < total) {
        if (isAborted())
            return;
        if (inFlight.size > 0) {
            await Promise.race(inFlight.values());
        }
        else {
            break;
        }
    }
    yieldReady();
    if (!isAborted())
        emit({ requestId: params.requestId, type: "genComplete" });
}
// Cleanup function for graceful shutdown
async function cleanup() {
    console.log("[Worker] Cleaning up...");
    // Release ONNX session (Kokoro)
    if (cachedSession) {
        try {
            await cachedSession.release();
            console.log("[Worker] ONNX session released");
        }
        catch (e) {
            // Ignore errors during cleanup
        }
        cachedSession = null;
        cachedModelId = null;
    }
}
// Handle messages from main process
parentPort?.on("message", async (message) => {
    const { type, requestId, data } = message;
    if (type === "shutdown") {
        console.log("[Worker] Shutdown requested");
        isShuttingDown = true;
        await cleanup();
        parentPort?.postMessage({ type: "shutdown_complete" });
        return;
    }
    if (type === "preload") {
        if (isShuttingDown)
            return;
        try {
            console.log("Preloading model:", data.model);
            await getModel(data.model);
            console.log("Model preloaded successfully");
        }
        catch (error) {
            console.error("Failed to preload model:", error);
        }
        return;
    }
    if (type === "cancel") {
        if (requestId)
            abortedRequests.add(requestId);
        wakeGen(); // unblock a parked generation so it sees the abort and stops
        return;
    }
    if (type === "setTarget") {
        // Renderer-driven buffer-ahead cap for the active quick-speak generation.
        // The renderer is the source of truth (it sends currentChunk+AHEAD as
        // playback advances, or Number.MAX_SAFE_INTEGER to force full generation on
        // Download), so we SET (not max) the target — letting a cancelled export
        // re-cap back to the normal window. Ignore messages for a superseded request.
        if (requestId && requestId === activeGenerateId && typeof data?.targetChunk === "number") {
            genTarget = data.targetChunk;
            wakeGen();
        }
        return;
    }
    if (type === "generateUnits") {
        if (isShuttingDown) {
            parentPort?.postMessage({ requestId, type: "error", error: "Worker is shutting down" });
            return;
        }
        try {
            await generateUnitsToStream({ requestId, ...data }, (msg) => parentPort?.postMessage(msg), () => isShuttingDown || abortedRequests.has(requestId));
        }
        catch (error) {
            console.error("[TTS Worker] generateUnits failed:", error);
            if (!isShuttingDown && !abortedRequests.has(requestId)) {
                const e = error;
                parentPort?.postMessage({
                    requestId,
                    type: "error",
                    error: e?.message || String(error),
                    stack: e?.stack || "",
                    platform: process.platform,
                    arch: process.arch,
                });
            }
        }
        finally {
            abortedRequests.delete(requestId);
        }
        return;
    }
    if (type === "generate") {
        if (isShuttingDown) {
            parentPort?.postMessage({
                requestId,
                type: "error",
                error: "Worker is shutting down",
            });
            return;
        }
        // Store requestId for progress messages + flow-control. Backpressure is
        // opt-in: if the caller (HTTP extension) didn't pass initialTarget, generate
        // fully (genTarget = Infinity), preserving the old behavior exactly.
        currentRequestId = requestId;
        activeGenerateId = requestId;
        genTarget =
            typeof data?.initialTarget === "number" ? data.initialTarget : Number.MAX_SAFE_INTEGER;
        genWake = null;
        try {
            const result = await generateVoice(data);
            // Check if we were interrupted
            if (isShuttingDown) {
                return;
            }
            // Convert ArrayBuffer to base64 for IPC transfer
            const buffer = Buffer.from(result.buffer);
            const base64 = buffer.toString("base64");
            parentPort?.postMessage({
                requestId,
                type: "result",
                data: {
                    base64,
                    mimeType: result.mimeType,
                },
            });
        }
        catch (error) {
            // Log full error to the worker's stderr so it surfaces in the Electron
            // main-process console — crucial for diagnosing platform-specific bugs
            // that only repro in packaged builds.
            console.error("[TTS Worker] generate failed:", error);
            if (abortedRequests.has(requestId)) {
                // Intentional cancel (stop / unmount / quit). Resolve the caller quietly
                // so its pending promise doesn't leak; flag it cancelled so main does NOT
                // fire the global tts:complete (which would otherwise hit whatever stream
                // started next and corrupt its flow control).
                parentPort?.postMessage({
                    requestId,
                    type: "result",
                    data: { base64: "", mimeType: "audio/wav", cancelled: true },
                });
            }
            else if (!isShuttingDown) {
                const message = error?.message || String(error);
                const stack = error?.stack || "";
                parentPort?.postMessage({
                    requestId,
                    type: "error",
                    error: message,
                    stack,
                    platform: process.platform,
                    arch: process.arch,
                });
            }
        }
        finally {
            // Only clear the shared flow-control globals if THIS run still owns them.
            // A superseded run's in-flight inference can settle AFTER the next run has
            // re-initialized these — without this guard it would null out the live
            // run's id/target/wake, ignoring its setTarget and deadlocking it.
            if (activeGenerateId === requestId) {
                currentRequestId = null;
                activeGenerateId = null;
                genWake = null;
            }
            abortedRequests.delete(requestId);
        }
    }
});
console.log("TTS Worker initialized");
//# sourceMappingURL=tts-worker.js.map