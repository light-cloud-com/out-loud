import { describe, it, expect, afterEach } from "vitest";
import { Worker } from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";

// Integration tests against the real compiled worker (electron/tts-worker.js)
// with the real Kokoro model. These pin the observable message contract for the
// pipeline-latency fixes:
//   - preload actually builds the ONNX session and says so (prewarm)
//   - a long single-clause first unit streams as more than one chunk (small
//     first sub-chunk => fast first audio)
//   - phonemization is lazy: an empty unit at the END of the batch is only
//     reached (and its unitDone emitted) after audio has started flowing,
//     instead of during an up-front whole-batch prep pass.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, "..", "electron", "tts-worker.js");

// One sentence, no internal punctuation, so it sanitizes to a single segment
// far above any first-chunk budget.
const LONG_SINGLE_CLAUSE =
  "the old lighthouse keeper slowly climbed the winding spiral staircase to the very top of " +
  "the ancient stone tower while the evening wind howled around the weathered walls outside";

const SHORT_SENTENCES = [
  "The keeper lit the lamp.",
  "Waves crashed on the rocks below.",
  "A ship passed in the night.",
  "The fog rolled in from the sea.",
  "Morning came slowly over the bay.",
  "The light kept turning all night.",
];

let workers: Worker[] = [];

function startWorker(): Worker {
  const w = new Worker(WORKER_PATH);
  workers.push(w);
  return w;
}

afterEach(async () => {
  await Promise.all(workers.map((w) => w.terminate()));
  workers = [];
});

function collectUntil(
  worker: Worker,
  isDone: (msg: any) => boolean,
  timeoutMs: number
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const timer = setTimeout(() => {
      worker.off("message", onMessage);
      reject(
        new Error(
          `timed out after ${timeoutMs}ms; got message types: ${messages.map((m) => m.type).join(", ")}`
        )
      );
    }, timeoutMs);
    const onMessage = (msg: any) => {
      messages.push(msg);
      if (msg.type === "error") {
        clearTimeout(timer);
        worker.off("message", onMessage);
        reject(new Error(`worker error: ${msg.error}`));
      }
      if (isDone(msg)) {
        clearTimeout(timer);
        worker.off("message", onMessage);
        resolve(messages);
      }
    };
    worker.on("message", onMessage);
  });
}

describe("tts-worker pipeline behavior", () => {
  it("preload builds the session and replies preloadComplete with sessionReady", async () => {
    const w = startWorker();
    const done = collectUntil(w, (m) => m.type === "preloadComplete", 20_000);
    w.postMessage({
      type: "preload",
      data: { model: "model_q8f16", acceleration: "cpu" },
    });
    const messages = await done;
    const reply = messages.find((m) => m.type === "preloadComplete");
    expect(reply.data.sessionReady).toBe(true);
  }, 30_000);

  it("fastStart streams a long single-clause first unit as more than one chunk", async () => {
    const w = startWorker();
    const done = collectUntil(w, (m) => m.type === "genComplete", 60_000);
    w.postMessage({
      type: "generateUnits",
      requestId: "first-chunk-test",
      data: {
        units: [{ id: "u0", text: LONG_SINGLE_CLAUSE }],
        lang: "en-us",
        voiceFormula: "af_heart",
        model: "model_q8f16",
        acceleration: "cpu",
        fastStart: true,
      },
    });
    const messages = await done;
    const audioChunks = messages.filter((m) => m.type === "unitChunk" && m.data.unitId === "u0");
    expect(audioChunks.length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it("without fastStart, a long single-clause unit stays one seamless chunk", async () => {
    const w = startWorker();
    const done = collectUntil(w, (m) => m.type === "genComplete", 60_000);
    w.postMessage({
      type: "generateUnits",
      requestId: "no-faststart-test",
      data: {
        units: [{ id: "u0", text: LONG_SINGLE_CLAUSE }],
        lang: "en-us",
        voiceFormula: "af_heart",
        model: "model_q8f16",
        acceleration: "cpu",
      },
    });
    const messages = await done;
    const audioChunks = messages.filter((m) => m.type === "unitChunk" && m.data.unitId === "u0");
    expect(audioChunks.length).toBe(1);
  }, 90_000);

  it("phonemizes lazily: a trailing empty unit's unitDone arrives after audio starts", async () => {
    const w = startWorker();
    const done = collectUntil(w, (m) => m.type === "genComplete", 120_000);
    const units = [
      ...SHORT_SENTENCES.map((text, i) => ({ id: `u${i}`, text })),
      { id: "u-empty", text: "" },
    ];
    w.postMessage({
      type: "generateUnits",
      requestId: "lazy-prep-test",
      data: {
        units,
        lang: "en-us",
        voiceFormula: "af_heart",
        model: "model_q8f16",
        acceleration: "cpu",
      },
    });
    const messages = await done;
    const firstChunkIdx = messages.findIndex((m) => m.type === "unitChunk");
    const emptyDoneIdx = messages.findIndex(
      (m) => m.type === "unitDone" && m.data.unitId === "u-empty"
    );
    expect(firstChunkIdx).toBeGreaterThanOrEqual(0);
    expect(emptyDoneIdx).toBeGreaterThan(firstChunkIdx);
  }, 150_000);
});
