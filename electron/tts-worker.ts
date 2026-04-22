import { parentPort } from "worker_threads";
import * as ort from "onnxruntime-node";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ESpeakNg from "espeak-ng";

import { createWavBuffer, modifyWavSpeed, wavToMp3 } from "./shared-audio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set ffmpeg path for fluent-ffmpeg
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const MODEL_CONTEXT_WINDOW = 512;
const SAMPLE_RATE = 24000;

// Look-ahead sizes per acceleration mode for streaming processing
const LOOK_AHEAD_SIZES: Record<string, number> = {
  cpu: 4,
  coreml: 3,
};

// Models directory - embedded in the app
// In packaged app, unpacked files are in app.asar.unpacked
const isPackaged = __dirname.includes("app.asar");
const MODELS_DIR = isPackaged
  ? path.join(__dirname.replace("app.asar", "app.asar.unpacked"), "models")
  : path.join(__dirname, "models");

console.log("[TTS Worker] __dirname:", __dirname);
console.log("[TTS Worker] isPackaged:", isPackaged);
console.log("[TTS Worker] MODELS_DIR:", MODELS_DIR);

// Keep ONNX session alive between requests for performance
let cachedSession: ort.InferenceSession | null = null;
let cachedModelId: string | null = null;

// Current request ID for progress messages
let currentRequestId: string | null = null;

// Shutdown flag to abort ongoing work
let isShuttingDown = false;

// Tokenizer vocab - all keys must be properly quoted strings
const vocab: { [phoneme: string]: number } = {
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
const langsMap: Record<string, string> = {
  "en-us": "en-us",
  "en-gb": "en-gb",
  ja: "ja",
  cmn: "cmn",
  "es-419": "es-419",
  hi: "hi",
  it: "it",
  "pt-br": "pt-br",
};

function tokenize(phonemes: string): number[] {
  const fallback_char = 16;
  return [...phonemes].map((char) => vocab[char] || fallback_char);
}

async function getModel(_id: string): Promise<ArrayBuffer> {
  // Only model_q8f16 is embedded
  const modelPath = path.join(MODELS_DIR, "model_q8f16.onnx");
  const data = await fs.readFile(modelPath);
  console.log("Loaded embedded model:", modelPath);
  return new Uint8Array(data).buffer;
}

async function getVoiceFile(id: string): Promise<ArrayBuffer> {
  const voicePath = path.join(MODELS_DIR, `${id}.bin`);
  const data = await fs.readFile(voicePath);
  console.log("Loaded embedded voice:", voicePath);
  return new Uint8Array(data).buffer;
}

async function getShapedVoiceFile(id: string): Promise<number[][][]> {
  const voice = await getVoiceFile(id);
  const voiceArray = new Float32Array(voice);
  const voiceArrayLen = voiceArray.length;

  const reshaped: number[][][] = [];
  for (let from = 0; from < voiceArray.length; from += 256) {
    const to = Math.min(from + 256, voiceArrayLen);
    const chunk = Array.from(voiceArray.slice(from, to));
    reshaped.push([chunk]);
  }

  return reshaped;
}

interface VoiceWeight {
  voiceId: string;
  weight: number;
}

function parseVoiceFormula(formula: string): VoiceWeight[] {
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

  const voices: VoiceWeight[] = [];
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

async function combineVoices(voices: VoiceWeight[]): Promise<number[][][]> {
  if (voices.length === 0) {
    throw new Error("You must select at least one voice");
  }

  const voiceArrays = await Promise.all(voices.map((v) => getShapedVoiceFile(v.voiceId)));

  const baseChunks = voiceArrays[0].length;
  const baseInner = voiceArrays[0][0].length;
  const baseLength = voiceArrays[0][0][0].length;

  const combinedVoice: number[][][] = [];
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

function normalizeText(text: string): string {
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

async function phonemize(text: string, langId: string): Promise<string> {
  const lang = langsMap[langId] || "en-us";
  text = normalizeText(text);

  const espeakArgs = ["--phonout", "generated", "-q", "--ipa", "-v", lang, text];

  const espeak = await ESpeakNg({
    arguments: espeakArgs,
  });

  const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
  return generated.split("\n").join(" ").trim();
}

function sanitizeText(rawText: string): string {
  return rawText
    .replace(/\.\s+/g, "[0.4s]")
    .replace(/,\s+/g, "[0.2s]")
    .replace(/;\s+/g, "[0.4s]")
    .replace(/:\s+/g, "[0.3s]")
    .replace(/!\s+/g, "![0.1s]")
    .replace(/\?\s+/g, "?[0.1s]")
    .replace(/\n+/g, "[0.4s]")
    .trim();
}

function segmentText(sanitizedText: string): string[] {
  const regex = /(\[[0-9]+(?:\.[0-9]+)?s\])/g;
  return sanitizedText
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function isSilenceMarker(segment: string): boolean {
  return /^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment.trim());
}

function extractSilenceDuration(marker: string): number {
  const match = marker.trim().match(/^\[([0-9]+(?:\.[0-9]+)?)s\]$/);
  return match ? parseFloat(match[1]) : 0;
}

function createPhonemeSubChunks(phonemes: string, tokensPerChunk: number): string[] {
  if (phonemes.length <= tokensPerChunk) return [phonemes];

  const chunks: string[] = [];
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

interface TextChunk {
  type: "text";
  content: string;
  tokens: number[];
}

interface SilenceChunk {
  type: "silence";
  durationSeconds: number;
}

type TextProcessorChunk = TextChunk | SilenceChunk;

async function preprocessText(
  text: string,
  lang: string,
  tokensPerChunk: number
): Promise<TextProcessorChunk[]> {
  const chunks: TextProcessorChunk[] = [];
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

function trimWaveform(waveform: Float32Array): Float32Array {
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
    if (avg > maxWindowAmp) maxWindowAmp = avg;
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

async function generateVoice(params: {
  text: string;
  lang: string;
  voiceFormula: string;
  model: string;
  speed: number;
  format: "wav" | "mp3";
  acceleration: "cpu" | "coreml";
}): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  if (params.speed < 0.1 || params.speed > 5) {
    throw new Error("Speed must be between 0.1 and 5");
  }

  const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
  const chunks = await preprocessText(params.text, params.lang, tokensPerChunk);

  // Get or create ONNX session
  let session: ort.InferenceSession;
  if (cachedSession && cachedModelId === params.model) {
    session = cachedSession;
  } else {
    const modelBuffer = await getModel(params.model);

    // Configure execution providers for GPU acceleration
    const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = [];

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

  // Prepare all chunks - categorize and pre-compute what we can
  interface PreparedChunk {
    originalIndex: number;
    type: "text" | "silence";
    tokens?: number[];
    silenceLength?: number;
  }

  const preparedChunks: PreparedChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (chunk.type === "silence") {
      const silenceLength = Math.floor(chunk.durationSeconds * SAMPLE_RATE);
      preparedChunks.push({ originalIndex: i, type: "silence", silenceLength });
    } else if (chunk.type === "text") {
      const tokensLength = chunk.tokens?.length ?? 0;
      if (tokensLength < 1) {
        continue;
      }
      preparedChunks.push({ originalIndex: i, type: "text", tokens: chunk.tokens });
    }
  }

  const totalChunks = preparedChunks.length;
  if (totalChunks === 0) {
    throw new Error("No chunks to process");
  }

  // Results array and tracking
  const results: Float32Array[] = new Array(totalChunks);
  const completed: boolean[] = new Array(totalChunks).fill(false);
  let nextToYield = 0;
  let nextToStart = 0;
  let completedCount = 0;

  // In-flight promises
  const inFlight = new Map<number, Promise<{ index: number; waveform: Float32Array }>>();

  // Process a single chunk
  const processChunk = async (chunkIdx: number) => {
    const prepared = preparedChunks[chunkIdx];

    if (prepared.type === "silence") {
      return { index: chunkIdx, waveform: new Float32Array(prepared.silenceLength!) };
    }

    const tokens = prepared.tokens!;
    const ref_s = combinedVoice[tokens.length - 1][0];
    const paddedTokens = [0, ...tokens, 0];
    const input_ids = new ort.Tensor("int64", BigInt64Array.from(paddedTokens.map(BigInt)), [
      1,
      paddedTokens.length,
    ]);
    const style = new ort.Tensor("float32", new Float32Array(ref_s), [1, ref_s.length]);
    const speed = new ort.Tensor("float32", [1], [1]);

    const result = await session.run({ input_ids, style, speed });
    let waveform = result.waveform.data as Float32Array;
    waveform = trimWaveform(waveform);

    return { index: chunkIdx, waveform };
  };

  // Yield consecutive completed chunks in order
  const yieldReadyChunks = () => {
    while (nextToYield < totalChunks && completed[nextToYield]) {
      // Send chunk ready via IPC for streaming playback
      const waveform = results[nextToYield];
      const wavBuffer = createWavBuffer(waveform, SAMPLE_RATE);
      const base64 = Buffer.from(wavBuffer).toString("base64");

      parentPort?.postMessage({
        requestId: currentRequestId,
        type: "chunk",
        data: {
          chunkIndex: nextToYield,
          totalChunks,
          base64,
          mimeType: "audio/wav",
        },
      });

      nextToYield++;
    }
  };

  // Fill look-ahead window
  const fillLookAhead = () => {
    while (inFlight.size < lookAhead && nextToStart < totalChunks) {
      const chunkIdx = nextToStart;
      nextToStart++;

      const promise = processChunk(chunkIdx);
      inFlight.set(chunkIdx, promise);

      promise.then((result) => {
        results[result.index] = result.waveform;
        completed[result.index] = true;
        completedCount++;
        inFlight.delete(result.index);

        // Report progress
        parentPort?.postMessage({
          requestId: currentRequestId,
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

  // Start processing
  fillLookAhead();

  // Wait for all to complete
  while (completedCount < totalChunks) {
    // Check for shutdown
    if (isShuttingDown) {
      throw new Error("Aborted due to shutdown");
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight.values());
    } else {
      break;
    }
  }

  // Final yield
  yieldReadyChunks();

  // Concatenate all waveforms for the final result
  const waveformsLen = results.reduce((sum, w) => sum + w.length, 0);
  const finalWaveform = new Float32Array(waveformsLen);
  let offset = 0;
  for (const waveform of results) {
    finalWaveform.set(waveform, offset);
    offset += waveform.length;
  }

  let wavBuffer = createWavBuffer(finalWaveform, SAMPLE_RATE);
  if (params.speed !== 1) {
    wavBuffer = await modifyWavSpeed(wavBuffer, params.speed);
  }

  if (params.format === "wav") {
    return { buffer: wavBuffer, mimeType: "audio/wav" };
  }

  return { buffer: await wavToMp3(wavBuffer), mimeType: "audio/mpeg" };
}

// Cleanup function for graceful shutdown
async function cleanup(): Promise<void> {
  console.log("[Worker] Cleaning up...");

  // Release ONNX session (Kokoro)
  if (cachedSession) {
    try {
      await cachedSession.release();
      console.log("[Worker] ONNX session released");
    } catch (e) {
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
    if (isShuttingDown) return;
    try {
      console.log("Preloading model:", data.model);
      await getModel(data.model);
      console.log("Model preloaded successfully");
    } catch (error) {
      console.error("Failed to preload model:", error);
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

    // Store requestId for progress messages
    currentRequestId = requestId;

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
    } catch (error: any) {
      if (!isShuttingDown) {
        parentPort?.postMessage({
          requestId,
          type: "error",
          error: error.message,
        });
      }
    } finally {
      currentRequestId = null;
    }
  }
});

console.log("TTS Worker initialized");
