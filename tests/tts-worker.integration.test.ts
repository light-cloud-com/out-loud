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

describe("tts-worker shutdown safety", () => {
  it("shuts down mid-generation without touching a disposed session", async () => {
    // The quit-while-playing crash: cleanup() released the ONNX session while
    // the generation loop still used it ("Session already disposed" here; a
    // fatal Napi::Error -> SIGABRT inside Electron). Shutdown must let
    // in-flight inference settle before releasing.
    const w = new Worker(WORKER_PATH, { stderr: true });
    workers.push(w);
    let stderr = "";
    w.stderr!.on("data", (d) => (stderr += String(d)));
    w.postMessage({
      type: "generateUnits",
      requestId: "shutdown-test",
      data: {
        units: SHORT_SENTENCES.map((text, i) => ({ id: `u${i}`, text })),
        lang: "en-us",
        voiceFormula: "af_heart",
        model: "model_q8f16",
        acceleration: "cpu",
      },
    });
    // Wait for the first audio chunk so we know an inference pipeline is hot.
    await collectUntil(w, (m) => m.type === "unitChunk", 30_000);
    // Request shutdown mid-generation: the worker must settle in-flight
    // inference, release the session, and reply — without crashing.
    const done = collectUntil(w, (m) => m.type === "shutdown_complete", 20_000);
    w.postMessage({ type: "shutdown" });
    const messages = await done;
    await new Promise((r) => setTimeout(r, 300)); // let trailing stderr flush
    expect(messages.some((m) => m.type === "shutdown_complete")).toBe(true);
    expect(stderr).not.toMatch(/Session already disposed|Napi::Error/);
  }, 60_000);
});

describe("tts-worker provider reporting & acceleration cache", () => {
  it("preloadComplete reports the session's execution providers", async () => {
    const w = startWorker();
    const done = collectUntil(w, (m) => m.type === "preloadComplete", 20_000);
    w.postMessage({
      type: "preload",
      data: { model: "model_q8f16", acceleration: "cpu" },
    });
    const messages = await done;
    const reply = messages.find((m) => m.type === "preloadComplete");
    expect(reply.data.providers).toEqual(["cpu"]);
  }, 30_000);

  it("rebuilds the session when the acceleration mode changes (sessionInfo per build)", async () => {
    const w = startWorker();
    const mk = (rid: string, acceleration: string) => ({
      type: "generateUnits",
      requestId: rid,
      data: {
        units: [{ id: "u0", text: "The keeper lit the lamp." }],
        lang: "en-us",
        voiceFormula: "af_heart",
        model: "model_q8f16",
        acceleration,
      },
    });
    // First generation on CPU -> one sessionInfo for the cpu session.
    const first = collectUntil(w, (m) => m.type === "genComplete", 60_000);
    w.postMessage(mk("accel-1", "cpu"));
    const firstMsgs = await first;
    const cpuInfos = firstMsgs.filter((m) => m.type === "sessionInfo");
    expect(cpuInfos.length).toBe(1);
    expect(cpuInfos[0].data.requested).toEqual(["cpu"]);
    expect(cpuInfos[0].data.effective).toEqual(["cpu"]);

    // Same model, different acceleration -> the cache must NOT serve the cpu
    // session; new sessionInfo message(s) report what was requested vs what
    // stuck. Whether CoreML initializes / survives inference for this model is
    // ORT-version-dependent: if it dies at run time, the worker must rebuild
    // CPU-only (an extra sessionInfo with fallback: true), retry, and still
    // deliver audio.
    const second = collectUntil(w, (m) => m.type === "genComplete", 120_000);
    w.postMessage(mk("accel-2", "coreml"));
    const secondMsgs = await second;
    const newInfos = secondMsgs.filter((m) => m.type === "sessionInfo");
    expect(newInfos.length).toBeGreaterThanOrEqual(1);
    expect(newInfos[0].data.requested).toContain("coreml");
    const last = newInfos[newInfos.length - 1];
    if (newInfos.some((m) => m.data.fallback)) {
      expect(last.data.effective).toEqual(["cpu"]);
    }
    // Whatever path it took, the generation must still produce audio.
    expect(secondMsgs.some((m) => m.type === "unitChunk")).toBe(true);
  }, 180_000);
});
