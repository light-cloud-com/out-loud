/**
 * Out Loud TTS Engine - Standalone browser-based text-to-speech
 * Powered by Kokoro-82M model, runs entirely in the browser using ONNX Runtime Web
 */

import * as ort from "onnxruntime-web";

// Constants
const MODEL_CONTEXT_WINDOW = 512;
const SAMPLE_RATE = 24000;
const DOWNLOAD_URL =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const ESPEAK_NG_WASM_URL = "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.wasm";

// Models configuration
const MODELS = {
  model: { id: "model", name: "Default (fp32)", size: "326 MB" },
  model_q8f16: { id: "model_q8f16", name: "Quantized q8f16 (Recommended)", size: "86 MB" },
  model_quantized: { id: "model_quantized", name: "Quantized 8-bit", size: "92.4 MB" },
  model_fp16: { id: "model_fp16", name: "FP16", size: "163 MB" },
  model_uint8: { id: "model_uint8", name: "UINT8", size: "177 MB" },
};

// Languages configuration
const LANGS = {
  "en-us": { id: "en-us", name: "English (US)", espeakId: "en-us" },
  "en-gb": { id: "en-gb", name: "English (UK)", espeakId: "en-gb" },
  ja: { id: "ja", name: "Japanese", espeakId: "ja" },
  cmn: { id: "cmn", name: "Chinese (Mandarin)", espeakId: "cmn" },
  "es-419": { id: "es-419", name: "Spanish", espeakId: "es-419" },
  hi: { id: "hi", name: "Hindi", espeakId: "hi" },
  it: { id: "it", name: "Italian", espeakId: "it" },
  "pt-br": { id: "pt-br", name: "Portuguese (Brazil)", espeakId: "pt-br" },
};

// Tokenizer vocabulary.
// Slots 14 and 15 are LEFT (U+201C) and RIGHT (U+201D) DOUBLE QUOTATION MARKS.
// They're written as Unicode escapes so editors/formatters don't silently
// normalize them to ASCII " and collide with slot 11.
const VOCAB = {
  ";": 1,
  ":": 2,
  ",": 3,
  ".": 4,
  "!": 5,
  "?": 6,
  "—": 9,
  "…": 10,
  '"': 11,
  "(": 12,
  ")": 13,
  "\u201C": 14,
  "\u201D": 15,
  " ": 16,
  "\u0303": 17,
  ʣ: 18,
  ʥ: 19,
  ʦ: 20,
  ʨ: 21,
  ᵝ: 22,
  "\uAB67": 23,
  A: 24,
  I: 25,
  O: 31,
  Q: 33,
  S: 35,
  T: 36,
  W: 39,
  Y: 41,
  ᵊ: 42,
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
  ɑ: 69,
  ɐ: 70,
  ɒ: 71,
  æ: 72,
  β: 75,
  ɔ: 76,
  ɕ: 77,
  ç: 78,
  ɖ: 80,
  ð: 81,
  ʤ: 82,
  ə: 83,
  ɚ: 85,
  ɛ: 86,
  ɜ: 87,
  ɟ: 90,
  ɡ: 92,
  ɥ: 99,
  ɨ: 101,
  ɪ: 102,
  ʝ: 103,
  ɯ: 110,
  ɰ: 111,
  ŋ: 112,
  ɳ: 113,
  ɲ: 114,
  ɴ: 115,
  ø: 116,
  ɸ: 118,
  θ: 119,
  œ: 120,
  ɹ: 123,
  ɾ: 125,
  ɻ: 126,
  ʁ: 128,
  ɽ: 129,
  ʂ: 130,
  ʃ: 131,
  ʈ: 132,
  ʧ: 133,
  ʊ: 135,
  ʋ: 136,
  ʌ: 138,
  ɣ: 139,
  ɤ: 140,
  χ: 142,
  ʎ: 143,
  ʒ: 147,
  ʔ: 148,
  ˈ: 156,
  ˌ: 157,
  ː: 158,
  ʰ: 162,
  ʲ: 164,
  "↓": 169,
  "→": 171,
  "↗": 172,
  "↘": 173,
  ᵻ: 177,
};

// Cache for models and voices
const cache = {
  model: null,
  modelId: null,
  voices: new Map(),
  espeakModule: null,
};

// Progress callback
let onProgress = null;

/**
 * Set progress callback
 */
export function setProgressCallback(callback) {
  onProgress = callback;
}

/**
 * Report progress
 */
function reportProgress(stage, progress, message) {
  if (onProgress) {
    onProgress({ stage, progress, message });
  }
}

/**
 * Download file with caching
 */
async function downloadFile(url, cacheKey) {
  try {
    const cacheStorage = await caches.open("out-loud-tts-cache");
    const cached = await cacheStorage.match(url);
    if (cached) {
      console.log(`Loaded from cache: ${cacheKey}`);
      return await cached.arrayBuffer();
    }
  } catch (e) {
    console.warn("Cache not available:", e);
  }

  console.log(`Downloading: ${url}`);
  reportProgress("download", 0, `Downloading ${cacheKey}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${cacheKey}: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  try {
    const cacheStorage = await caches.open("out-loud-tts-cache");
    await cacheStorage.put(url, new Response(buffer.slice(0)));
  } catch (e) {
    console.warn("Failed to cache:", e);
  }

  reportProgress("download", 100, `Downloaded ${cacheKey}`);
  return buffer;
}

/**
 * Load ONNX model
 */
async function loadModel(modelId = "model_q8f16") {
  if (cache.model && cache.modelId === modelId) {
    return cache.model;
  }

  const model = MODELS[modelId] || MODELS["model_q8f16"];
  const url = `${DOWNLOAD_URL}/onnx/${model.id}.onnx`;

  reportProgress("model", 0, `Loading model ${model.name}...`);
  const buffer = await downloadFile(url, `model-${modelId}`);

  reportProgress("model", 50, "Initializing ONNX runtime...");

  // Configure ONNX Runtime for WebGPU if available, fallback to WASM
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/";

  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });

  cache.model = session;
  cache.modelId = modelId;
  reportProgress("model", 100, "Model loaded");

  return session;
}

/**
 * Load voice file
 */
async function loadVoice(voiceId) {
  if (cache.voices.has(voiceId)) {
    return cache.voices.get(voiceId);
  }

  const url = `${DOWNLOAD_URL}/voices/${voiceId}.bin`;
  const buffer = await downloadFile(url, `voice-${voiceId}`);

  const voiceArray = new Float32Array(buffer);
  const reshaped = [];
  for (let from = 0; from < voiceArray.length; from += 256) {
    const to = Math.min(from + 256, voiceArray.length);
    const chunk = Array.from(voiceArray.slice(from, to));
    reshaped.push([chunk]);
  }

  cache.voices.set(voiceId, reshaped);
  return reshaped;
}

/**
 * Load espeak-ng module
 */
async function loadEspeak() {
  if (cache.espeakModule) {
    return cache.espeakModule;
  }

  // Dynamically import espeak-ng
  const ESpeakNg = (await import("https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.mjs"))
    .default;
  return ESpeakNg;
}

/**
 * Phonemize text
 */
async function phonemize(text, langId) {
  const lang = LANGS[langId] || LANGS["en-us"];
  text = normalizeText(text);

  const espeakArgs = ["--phonout", "generated", "-q", "--ipa", "-v", lang.id, text];

  const ESpeakNg = await loadEspeak();
  const espeak = await ESpeakNg({
    locateFile: () => ESPEAK_NG_WASM_URL,
    arguments: espeakArgs,
  });

  const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
  return generated.split("\n").join(" ").trim();
}

/**
 * Normalize text for phonemization
 */
function normalizeText(text) {
  return text
    .replaceAll("'", "'")
    .replaceAll("'", "'")
    .replaceAll("«", "(")
    .replaceAll("»", ")")
    .replaceAll('"', '"')
    .replaceAll('"', '"')
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replaceAll("\n", "  ")
    .replaceAll("\t", "  ")
    .trim();
}

/**
 * Tokenize phonemes
 */
function tokenize(phonemes) {
  const fallback = 16;
  return [...phonemes].map((char) => VOCAB[char] || fallback);
}

/**
 * Sanitize text (replace punctuation with silence markers)
 */
function sanitizeText(rawText) {
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

/**
 * Segment text by silence markers
 */
function segmentText(sanitizedText) {
  const regex = /(\[[0-9]+(?:\.[0-9]+)?s\])/g;
  return sanitizedText
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Check if segment is silence marker
 */
function isSilenceMarker(segment) {
  return /^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment.trim());
}

/**
 * Extract silence duration
 */
function extractSilenceDuration(marker) {
  const match = marker.trim().match(/^\[([0-9]+(?:\.[0-9]+)?)s\]$/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Split phonemes into chunks
 */
function createPhonemeSubChunks(phonemes, tokensPerChunk) {
  if (phonemes.length <= tokensPerChunk) return [phonemes];

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

/**
 * Preprocess text into chunks
 */
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

/**
 * Trim waveform silence
 */
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

/**
 * Create WAV buffer from waveform
 */
function createWavBuffer(waveform, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 32;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = waveform.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 3, true); // IEEE float format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write audio data
  const floatView = new Float32Array(buffer, 44);
  floatView.set(waveform);

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Parse voice formula
 */
function parseVoiceFormula(formula) {
  formula = formula.replace(/\s+/g, "");
  if (formula === "") {
    throw new Error("Voice formula cannot be empty");
  }

  const terms = formula.split("+").filter((term) => term !== "");

  if (terms.length === 1 && !terms[0].includes("*")) {
    return [{ voiceId: terms[0], weight: 1 }];
  }

  const voices = [];
  for (const term of terms) {
    if (!term.includes("*")) {
      throw new Error(`Invalid term: ${term}`);
    }
    const [voiceId, weightStr] = term.split("*");
    let weight = parseFloat(weightStr);
    if (isNaN(weight) || weight < 0 || weight > 1) {
      throw new Error(`Invalid weight for voice ${voiceId}`);
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

/**
 * Combine multiple voices
 */
async function combineVoices(voices) {
  if (voices.length === 0) {
    throw new Error("At least one voice required");
  }

  const voiceArrays = await Promise.all(voices.map((v) => loadVoice(v.voiceId)));

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

/**
 * Generate speech from text
 * @param {Object} params - Generation parameters
 * @param {string} params.text - Text to speak
 * @param {string} params.voice - Voice ID or formula
 * @param {string} params.lang - Language ID
 * @param {string} params.model - Model ID
 * @returns {Promise<{buffer: ArrayBuffer, mimeType: string}>}
 */
export async function generateSpeech(params) {
  const { text, voice = "af_heart", lang = "en-us", model = "model_q8f16" } = params;

  if (!text || text.trim() === "") {
    throw new Error("Text cannot be empty");
  }

  reportProgress("init", 0, "Initializing...");

  // Load model
  const session = await loadModel(model);

  // Parse voice formula and load voices
  reportProgress("voice", 0, "Loading voice...");
  const voices = parseVoiceFormula(voice);
  const combinedVoice = await combineVoices(voices);
  reportProgress("voice", 100, "Voice loaded");

  // Preprocess text
  reportProgress("process", 0, "Processing text...");
  const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
  const chunks = await preprocessText(text, lang, tokensPerChunk);
  reportProgress("process", 100, "Text processed");

  // Generate waveforms
  reportProgress("generate", 0, "Generating audio...");
  const waveforms = [];
  let waveformsLen = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    reportProgress(
      "generate",
      Math.round((i / chunks.length) * 100),
      `Generating chunk ${i + 1}/${chunks.length}`
    );

    if (chunk.type === "silence") {
      const silenceLength = Math.floor(chunk.durationSeconds * SAMPLE_RATE);
      const silenceWave = new Float32Array(silenceLength);
      waveforms.push(silenceWave);
      waveformsLen += silenceLength;
      continue;
    }

    if (chunk.type === "text") {
      const tokensLength = chunk.tokens?.length ?? 0;
      if (tokensLength < 1) continue;

      const tokens = chunk.tokens;
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

      if (waveform.length === 0) {
        console.warn("Empty waveform generated for chunk");
        continue;
      }

      waveforms.push(waveform);
      waveformsLen += waveform.length;
    }
  }

  if (waveforms.length === 0) {
    throw new Error("No audio generated");
  }

  // Concatenate waveforms
  reportProgress("finalize", 0, "Finalizing...");
  const finalWaveform = new Float32Array(waveformsLen);
  let offset = 0;
  for (const waveform of waveforms) {
    finalWaveform.set(waveform, offset);
    offset += waveform.length;
  }

  // Create WAV buffer
  const wavBuffer = createWavBuffer(finalWaveform, SAMPLE_RATE);
  reportProgress("finalize", 100, "Done!");

  return {
    buffer: wavBuffer,
    mimeType: "audio/wav",
  };
}

/**
 * Get available voices
 */
export function getVoices() {
  return {
    "en-us": [
      { id: "af_heart", name: "Heart", gender: "Female" },
      { id: "af_bella", name: "Bella", gender: "Female" },
      { id: "af_nicole", name: "Nicole", gender: "Female" },
      { id: "af_sarah", name: "Sarah", gender: "Female" },
      { id: "af_nova", name: "Nova", gender: "Female" },
      { id: "af_sky", name: "Sky", gender: "Female" },
      { id: "am_michael", name: "Michael", gender: "Male" },
      { id: "am_adam", name: "Adam", gender: "Male" },
      { id: "am_echo", name: "Echo", gender: "Male" },
    ],
    "en-gb": [
      { id: "bf_emma", name: "Emma", gender: "Female" },
      { id: "bf_isabella", name: "Isabella", gender: "Female" },
      { id: "bm_george", name: "George", gender: "Male" },
      { id: "bm_lewis", name: "Lewis", gender: "Male" },
    ],
    ja: [
      { id: "jf_alpha", name: "Alpha", gender: "Female" },
      { id: "jm_kumo", name: "Kumo", gender: "Male" },
    ],
    cmn: [
      { id: "zf_xiaobei", name: "Xiaobei", gender: "Female" },
      { id: "zm_yunjian", name: "Yunjian", gender: "Male" },
    ],
    "es-419": [
      { id: "ef_dora", name: "Dora", gender: "Female" },
      { id: "em_alex", name: "Alex", gender: "Male" },
    ],
    hi: [
      { id: "hf_alpha", name: "Alpha", gender: "Female" },
      { id: "hm_omega", name: "Omega", gender: "Male" },
    ],
    it: [
      { id: "if_sara", name: "Sara", gender: "Female" },
      { id: "im_nicola", name: "Nicola", gender: "Male" },
    ],
    "pt-br": [
      { id: "pf_dora", name: "Dora", gender: "Female" },
      { id: "pm_alex", name: "Alex", gender: "Male" },
    ],
  };
}

/**
 * Get available models
 */
export function getModels() {
  return MODELS;
}

/**
 * Get available languages
 */
export function getLanguages() {
  return LANGS;
}

// Export for use
export default {
  generateSpeech,
  getVoices,
  getModels,
  getLanguages,
  setProgressCallback,
};
