import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, screen, } from "electron";
import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { fileURLToPath } from "url";
import WordExtractor from "word-extractor";
import { startUpdateChecks, stopUpdateChecks, getUpdate, skipVersion } from "./update-check.js";
import { getRecents, putRecent, removeRecent } from "./reader-recents.js";
import { initTelemetry, track, trackFromRenderer, trackSessionStart, shutdownTelemetry, lengthBucket, } from "./telemetry.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load app icon from PNG file
const iconPath = path.join(__dirname, "icon.png");
const APP_ICON_BASE64 = fs.readFileSync(iconPath).toString("base64");
// Load tray icon (transparent background for macOS template image)
const trayIconPath = path.join(__dirname, "tray-icon.png");
const TRAY_ICON_BASE64 = fs.readFileSync(trayIconPath).toString("base64");
// Load Light Cloud logo
const lightCloudLogoPath = path.join(__dirname, "lightcloud-logo.png");
const LIGHTCLOUD_LOGO_BASE64 = fs.readFileSync(lightCloudLogoPath).toString("base64");
let mainWindow = null;
let ttsWorker = null;
let tray = null;
let httpServer = null;
const UI_DEV_PORT = 51731;
const EXTENSION_API_PORT = 51730;
// Keep track of pending TTS requests
const pendingRequests = new Map();
// Track if app is quitting
let isAppQuitting = false;
// The in-flight quick-speak generation id (for buffer-target / cancel / quit).
let activeQuickSpeakRequest = null;
// Per-session usage counters, summarised into the session_ended event.
let ttsRequestsThisSession = 0;
let docsOpenedThisSession = 0;
// Distinct document paths opened this session, so docsOpenedThisSession counts
// distinct documents rather than every resume / re-read of the same file.
const openedPathsThisSession = new Set();
// Map a worker error into a coarse category WITHOUT ever forwarding the raw
// message (which can contain file paths or content). Best-effort keyword match.
function ttsErrorCategory(message) {
    const m = (message || "").toLowerCase();
    if (m.includes("model"))
        return "model_load";
    if (m.includes("voice"))
        return "voice_load";
    if (m.includes("phonem") || m.includes("espeak"))
        return "phonemize";
    if (m.includes("wav") || m.includes("mp3") || m.includes("ffmpeg") || m.includes("encod"))
        return "encoding";
    if (m.includes("onnx") || m.includes("session") || m.includes("infer"))
        return "inference";
    return "other";
}
// Reader: in-flight windowed-generation requests (separate from quick-speak's
// pendingRequests). Chunks/unitDone/complete are forwarded straight to the
// renderer, keyed by requestId; the renderer's engine matches them up.
const readerRequests = new Set();
let activeReaderRequest = null;
// Extra width added to the window while the sidebar is open (removed on close).
let sidebarExtraWidth = 0;
// Tray animation for playing state
let trayAnimationInterval = null;
let trayAnimationFrame = 0;
let trayIconDefault = null;
// Create animated sound wave icons (simple bars at different heights)
function createAnimatedTrayIcon(frame) {
    // 22x22 icon with 3 bars animated
    const heights = [
        [4, 8, 4], // frame 0
        [6, 4, 8], // frame 1
        [8, 6, 4], // frame 2
        [4, 8, 6], // frame 3
    ][frame % 4];
    // Create SVG for the icon
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    <rect x="5" y="${11 - heights[0]}" width="3" height="${heights[0] * 2}" rx="1" fill="black"/>
    <rect x="10" y="${11 - heights[1]}" width="3" height="${heights[1] * 2}" rx="1" fill="black"/>
    <rect x="15" y="${11 - heights[2]}" width="3" height="${heights[2] * 2}" rx="1" fill="black"/>
  </svg>`;
    // Convert SVG to data URL for proper image creation
    const base64Svg = Buffer.from(svg).toString("base64");
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${base64Svg}`);
    icon.setTemplateImage(true);
    return icon;
}
function startTrayAnimation() {
    if (trayAnimationInterval)
        return;
    trayAnimationFrame = 0;
    trayAnimationInterval = setInterval(() => {
        if (!tray)
            return;
        trayAnimationFrame = (trayAnimationFrame + 1) % 4;
        const animatedIcon = createAnimatedTrayIcon(trayAnimationFrame);
        tray.setImage(animatedIcon);
        tray.setToolTip("Out Loud - Playing");
    }, 200);
}
function stopTrayAnimation() {
    if (trayAnimationInterval) {
        clearInterval(trayAnimationInterval);
        trayAnimationInterval = null;
    }
    if (tray && trayIconDefault) {
        tray.setImage(trayIconDefault);
        tray.setToolTip("Out Loud - Ready");
    }
}
// Check if in development mode
const isDev = process.env.NODE_ENV === "development";
function createWindow() {
    const preloadPath = path.join(__dirname, "preload.cjs");
    console.log("[Main] Preload path:", preloadPath);
    const isMac = process.platform === "darwin";
    mainWindow = new BrowserWindow({
        width: 480,
        height: 600,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        // Frameless-with-traffic-lights only makes sense on macOS. On Windows/Linux
        // we keep the native frame so users get the expected min/max/close buttons
        // and OS-native drag, instead of an invisible drag region fighting them.
        ...(isMac ? { titleBarStyle: "hiddenInset" } : { frame: true }),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            preload: preloadPath,
        },
    });
    // Load React UI - from dev server in development, from built files in production
    if (isDev) {
        mainWindow.loadURL(`http://localhost:${UI_DEV_PORT}`);
    }
    else {
        const uiPath = path.join(__dirname, "..", "electron-ui", "dist", "index.html");
        mainWindow.loadFile(uiPath);
    }
    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    // Hide instead of close on macOS
    mainWindow.on("close", (event) => {
        if (process.platform === "darwin" && !isAppQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
}
function createTray() {
    // Use dedicated tray icon (transparent bg, black waveform for template)
    const trayIcon = nativeImage.createFromDataURL("data:image/png;base64," + TRAY_ICON_BASE64);
    trayIcon.setTemplateImage(true);
    trayIconDefault = trayIcon;
    tray = new Tray(trayIcon);
    tray.setToolTip("Out Loud - Ready");
    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Show Window",
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
                else {
                    createWindow();
                }
            },
        },
        { type: "separator" },
        {
            label: "About Out Loud",
            click: () => {
                const { shell } = require("electron");
                shell.openExternal("https://www.out-loud.io");
            },
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                isAppQuitting = true;
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on("click", () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            }
            else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
        else {
            createWindow();
        }
    });
}
function createTTSWorker() {
    const workerPath = path.join(__dirname, "tts-worker.js");
    console.log("[Worker] Starting from:", workerPath);
    ttsWorker = new Worker(workerPath);
    ttsWorker.on("message", (message) => {
        const { requestId, type, data, error } = message;
        console.log("[Worker] Message:", type, requestId ? `(${requestId.slice(0, 8)})` : "");
        // Reader (windowed generation): forward straight to the renderer.
        if (type === "unitChunk" ||
            type === "unitDone" ||
            type === "genComplete" ||
            type === "aborted") {
            mainWindow?.webContents.send(`reader:${type}`, { requestId, ...(data || {}) });
            if (type === "genComplete" || type === "aborted") {
                readerRequests.delete(requestId);
                if (activeReaderRequest === requestId)
                    activeReaderRequest = null;
            }
            return;
        }
        if (type === "progress") {
            mainWindow?.webContents.send("tts:progress", data);
            const pending = pendingRequests.get(requestId);
            if (pending?.onChunk) {
                pending.onChunk({ type: "progress", data });
            }
            return;
        }
        if (type === "chunk") {
            const pending = pendingRequests.get(requestId);
            if (pending?.onChunk) {
                pending.onChunk({ type: "chunk", data });
            }
            return;
        }
        if (type === "result") {
            const pending = pendingRequests.get(requestId);
            if (pending) {
                pending.resolve(data);
                pendingRequests.delete(requestId);
            }
        }
        if (type === "error") {
            const { stack, platform, arch } = message;
            console.error("[Worker] TTS error:", error, stack ? `\n  stack: ${stack}` : "", platform ? `\n  platform: ${platform}/${arch}` : "");
            // Category + platform only — never the raw message/stack/paths.
            track("tts_error", {
                error_category: ttsErrorCategory(error),
                mode: readerRequests.has(requestId) ? "reader" : "quick_speak",
                platform: platform || process.platform,
                arch: arch || process.arch,
            });
            // Reader-side failure → notify the renderer's engine.
            if (readerRequests.has(requestId)) {
                readerRequests.delete(requestId);
                if (activeReaderRequest === requestId)
                    activeReaderRequest = null;
                mainWindow?.webContents.send("reader:error", { requestId, error });
                return;
            }
            const pending = pendingRequests.get(requestId);
            if (pending) {
                const richError = new Error(error);
                richError.stack = stack || richError.stack;
                richError.workerPlatform = platform;
                richError.workerArch = arch;
                pending.reject(richError);
                pendingRequests.delete(requestId);
            }
        }
    });
    ttsWorker.on("error", (error) => {
        console.error("[Worker] ERROR:", error);
    });
    ttsWorker.on("exit", (code) => {
        console.error("[Worker] Exited with code:", code);
    });
}
async function preloadModel() {
    if (ttsWorker) {
        console.log("[Main] Requesting model preload...");
        ttsWorker.postMessage({
            type: "preload",
            data: { model: "model_q8f16" },
        });
    }
}
function generateTTS(params, onChunk, requestId) {
    return new Promise((resolve, reject) => {
        if (!ttsWorker) {
            reject(new Error("TTS Worker not initialized"));
            return;
        }
        // Use the renderer-minted id when provided (quick-speak, so it can target /
        // cancel the request); otherwise mint one (HTTP extension path).
        const id = requestId || crypto.randomUUID();
        pendingRequests.set(id, { resolve, reject, onChunk });
        ttsWorker.postMessage({
            type: "generate",
            requestId: id,
            data: params,
        });
    });
}
// ---- Reader: windowed generation bridge ----
function readerGenerate(params) {
    if (!ttsWorker)
        throw new Error("TTS Worker not initialized");
    // A brand-new request supersedes any previous one still running (seek/restart).
    if (activeReaderRequest && activeReaderRequest !== params.requestId) {
        ttsWorker.postMessage({ type: "cancel", requestId: activeReaderRequest });
        readerRequests.delete(activeReaderRequest);
    }
    const lang = getVoiceLang(params.voice);
    readerRequests.add(params.requestId);
    activeReaderRequest = params.requestId;
    ttsWorker.postMessage({
        type: "generateUnits",
        requestId: params.requestId,
        data: {
            units: params.units,
            lang,
            voiceFormula: params.voice,
            model: "model_q8f16",
            // CPU keeps the ONNX session shared with quick-speak (no thrash). CoreML
            // is a future tuning lever for macOS if generation can't keep up.
            acceleration: "cpu",
        },
    });
}
function readerCancel(requestId) {
    if (ttsWorker)
        ttsWorker.postMessage({ type: "cancel", requestId });
    readerRequests.delete(requestId);
    if (activeReaderRequest === requestId)
        activeReaderRequest = null;
}
function readFileForReader(filePath) {
    const data = fs.readFileSync(filePath);
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return { path: filePath, name: path.basename(filePath), bytes };
}
// Opening the sidebar grows the window width by ~20% so the existing content
// keeps its size; closing shrinks it back by the same amount (preserving any
// manual resize the user did while it was open).
function setSidebarWindow(open) {
    if (!mainWindow)
        return;
    const b = mainWindow.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    if (open) {
        if (sidebarExtraWidth > 0)
            return; // already widened
        const extra = Math.round(b.width * 0.2);
        const width = Math.min(b.width + extra, wa.width);
        sidebarExtraWidth = width - b.width;
        if (sidebarExtraWidth <= 0)
            return;
        mainWindow.setBounds({ ...b, width }, true);
    }
    else {
        if (sidebarExtraWidth <= 0)
            return;
        const width = Math.max(b.width - sidebarExtraWidth, 400);
        sidebarExtraWidth = 0;
        mainWindow.setBounds({ ...b, width }, true);
    }
}
function getVoiceLang(voiceId) {
    const prefix = voiceId.substring(0, 2);
    const langMap = {
        af: "en-us",
        am: "en-us",
        bf: "en-gb",
        bm: "en-gb",
        jf: "ja",
        jm: "ja",
        zf: "cmn",
        zm: "cmn",
        ef: "es-419",
        em: "es-419",
        hf: "hi",
        hm: "hi",
        if: "it",
        im: "it",
        pf: "pt-br",
        pm: "pt-br",
    };
    return langMap[prefix] || "en-us";
}
function getVoicesList() {
    return [
        { id: "af_heart", name: "Heart", lang: "en-us", engine: "kokoro" },
        { id: "af_bella", name: "Bella", lang: "en-us", engine: "kokoro" },
        { id: "am_michael", name: "Michael", lang: "en-us", engine: "kokoro" },
        { id: "am_adam", name: "Adam", lang: "en-us", engine: "kokoro" },
        { id: "bf_emma", name: "Emma", lang: "en-gb", engine: "kokoro" },
        { id: "bm_george", name: "George", lang: "en-gb", engine: "kokoro" },
        { id: "jf_alpha", name: "Alpha", lang: "ja", engine: "kokoro" },
        { id: "jm_kumo", name: "Kumo", lang: "ja", engine: "kokoro" },
        { id: "zf_xiaobei", name: "Xiaobei", lang: "cmn", engine: "kokoro" },
        { id: "zm_yunjian", name: "Yunjian", lang: "cmn", engine: "kokoro" },
    ];
}
let sharedSettings = {
    text: "",
    language: "en-us",
    voice: "af_heart",
    volume: 80,
    highlightChunk: false,
};
function getSharedSettings() {
    return { ...sharedSettings };
}
function updateSharedSettings(updates, options = {}) {
    sharedSettings = { ...sharedSettings, ...updates };
    // Broadcast to the renderer ONLY when the change came from outside the
    // renderer (e.g. the Chrome extension via the HTTP API). Broadcasting
    // back to the same renderer that initiated an IPC update races with
    // subsequent keystrokes: the echo arrives after React has already
    // applied newer state, so setSettings(broadcast) overwrites unsynced
    // characters and the textarea looks like it's dropping letters.
    if (options.broadcast !== false) {
        mainWindow?.webContents.send("settings:updated", sharedSettings);
    }
    return sharedSettings;
}
// ============ HTTP Server for Extensions ============
function createExtensionServer() {
    httpServer = http.createServer(async (req, res) => {
        // Security: Only accept localhost connections
        const remoteAddr = req.socket.remoteAddress;
        const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
        if (!isLocalhost) {
            console.log(`[HTTP] Rejected non-localhost request from ${remoteAddr}`);
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Forbidden: localhost only" }));
            return;
        }
        // CORS headers for extension access
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url || "/", `http://localhost:${EXTENSION_API_PORT}`);
        // GET /api/v1/openapi.yaml - OpenAPI 3.1 spec
        if (req.method === "GET" && url.pathname === "/api/v1/openapi.yaml") {
            try {
                // In packaged builds, the spec is copied into resources/ via extraResources.
                // In dev, read it from the repo at docs/app/openapi.yaml.
                const specPath = app.isPackaged
                    ? path.join(process.resourcesPath, "openapi.yaml")
                    : path.join(__dirname, "..", "docs", "app", "openapi.yaml");
                const spec = fs.readFileSync(specPath, "utf-8");
                res.writeHead(200, { "Content-Type": "application/yaml" });
                res.end(spec);
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "openapi.yaml not found", detail: err.message }));
            }
            return;
        }
        // GET /api/v1/audio/voices
        if (req.method === "GET" && url.pathname === "/api/v1/audio/voices") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ voices: getVoicesList() }));
            return;
        }
        // GET /api/v1/settings - Get shared settings
        if (req.method === "GET" && url.pathname === "/api/v1/settings") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(getSharedSettings()));
            return;
        }
        // POST /api/v1/settings - Update shared settings
        if (req.method === "POST" && url.pathname === "/api/v1/settings") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                try {
                    const updates = JSON.parse(body);
                    const newSettings = updateSharedSettings(updates);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(newSettings));
                }
                catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // POST /api/v1/audio/speech/stream - Streaming TTS
        if (req.method === "POST" && url.pathname === "/api/v1/audio/speech/stream") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const params = JSON.parse(body);
                    const { voice, input, speed } = params;
                    const lang = getVoiceLang(voice);
                    console.log("[HTTP] Streaming request:", { voice, lang, textLength: input?.length });
                    track("extension_api_request", {
                        endpoint: "stream",
                        voice_id: voice,
                        text_length_bucket: lengthBucket(typeof input === "string" ? input.length : 0),
                        format: "wav",
                    });
                    res.writeHead(200, {
                        "Content-Type": "application/octet-stream",
                        "Transfer-Encoding": "chunked",
                    });
                    await generateTTS({
                        text: input,
                        lang,
                        voiceFormula: voice,
                        model: "model_q8f16",
                        speed: speed || 1,
                        format: "wav",
                        acceleration: "cpu",
                        streaming: true,
                    }, (msg) => {
                        if (msg.type === "chunk") {
                            const { chunkIndex, totalChunks, base64 } = msg.data;
                            const wavBuffer = Buffer.from(base64, "base64");
                            // Write chunk header (12 bytes) + WAV data
                            const header = Buffer.alloc(12);
                            header.writeUInt32LE(chunkIndex, 0);
                            header.writeUInt32LE(totalChunks, 4);
                            header.writeUInt32LE(wavBuffer.length, 8);
                            res.write(header);
                            res.write(wavBuffer);
                        }
                    });
                    res.end();
                }
                catch (error) {
                    console.error("[HTTP] Streaming error:", error);
                    if (!res.headersSent) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                    }
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // POST /api/v1/audio/speech - Blocking TTS (full audio)
        if (req.method === "POST" && url.pathname === "/api/v1/audio/speech") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const params = JSON.parse(body);
                    const { voice, input, speed, response_format } = params;
                    const lang = getVoiceLang(voice);
                    console.log("[HTTP] Blocking request:", { voice, lang, textLength: input?.length });
                    track("extension_api_request", {
                        endpoint: "blocking",
                        voice_id: voice,
                        text_length_bucket: lengthBucket(typeof input === "string" ? input.length : 0),
                        format: response_format === "mp3" ? "mp3" : "wav",
                    });
                    // Collect all chunks
                    const chunks = [];
                    await generateTTS({
                        text: input,
                        lang,
                        voiceFormula: voice,
                        model: "model_q8f16",
                        speed: speed || 1,
                        format: response_format === "mp3" ? "mp3" : "wav",
                        acceleration: "cpu",
                        streaming: true,
                    }, (msg) => {
                        if (msg.type === "chunk") {
                            const { base64 } = msg.data;
                            chunks.push(Buffer.from(base64, "base64"));
                        }
                    });
                    // Concatenate all audio chunks
                    const fullAudio = Buffer.concat(chunks);
                    const contentType = response_format === "mp3" ? "audio/mpeg" : "audio/wav";
                    res.writeHead(200, { "Content-Type": contentType });
                    res.end(fullAudio);
                }
                catch (error) {
                    console.error("[HTTP] Blocking error:", error);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // 404 for unknown routes
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    });
    httpServer.listen(EXTENSION_API_PORT, "127.0.0.1", () => {
        console.log(`[HTTP] Extension API server running on http://127.0.0.1:${EXTENSION_API_PORT}`);
    });
    httpServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`[HTTP] Port ${EXTENSION_API_PORT} already in use - extension API disabled`);
        }
        else {
            console.error("[HTTP] Server error:", err);
        }
    });
}
// ============ IPC Handlers ============
// Get available voices
ipcMain.handle("tts:voices", async () => {
    return getVoicesList();
});
// Get shared settings
ipcMain.handle("settings:get", async () => {
    return getSharedSettings();
});
// Update shared settings from the renderer. We deliberately suppress the
// settings:updated broadcast here — the renderer already has the new state
// (it called us with it) and a broadcast would race with later keystrokes.
ipcMain.handle("settings:update", async (_event, updates) => {
    // settings_changed captures discrete setting toggles that DON'T already have a
    // dedicated event. We exclude:
    //   - text:            user content (never sent),
    //   - voice/language:  each has its own renderer event (avoid double-counting),
    //   - volume:          a continuous slider that fires per drag-tick (noise).
    // The renderer sends the full settings object on every change, so we diff
    // against the current values to report only the key(s) that actually changed.
    const SKIP = new Set(["text", "voice", "language", "volume"]);
    const current = sharedSettings;
    const next = (updates || {});
    const changedKeys = Object.keys(next).filter((k) => !SKIP.has(k) && next[k] !== current[k]);
    if (changedKeys.length > 0)
        track("settings_changed", { changed_keys: changedKeys });
    return updateSharedSettings(updates, { broadcast: false });
});
// Start streaming TTS generation
ipcMain.handle("tts:stream:start", async (_event, params) => {
    const { voice, text, speed, requestId, initialTarget } = params;
    const lang = getVoiceLang(voice);
    const startedAt = Date.now();
    console.log("[TTS] Streaming request:", { voice, lang, textLength: text.length });
    // Track the active quick-speak request so it can be cancelled on quit.
    if (typeof requestId === "string")
        activeQuickSpeakRequest = requestId;
    try {
        const result = await generateTTS({
            text,
            lang,
            voiceFormula: voice,
            model: "model_q8f16",
            speed: speed || 1,
            format: "wav",
            acceleration: "cpu",
            streaming: true,
            // Backpressure: generate only this many chunks ahead until the renderer
            // advances the target (undefined → full generation for non-renderer callers).
            initialTarget: typeof initialTarget === "number" ? initialTarget : undefined,
        }, (msg) => {
            if (msg.type === "chunk") {
                const { chunkIndex, totalChunks, base64 } = msg.data;
                // Tag with the request id so the renderer can drop stale chunks from a
                // just-cancelled request that arrive after a new play() started.
                mainWindow?.webContents.send("tts:chunk", {
                    chunkIndex,
                    totalChunks,
                    base64,
                    requestId,
                });
            }
        }, typeof requestId === "string" ? requestId : undefined);
        if (activeQuickSpeakRequest === requestId)
            activeQuickSpeakRequest = null;
        // A cancelled request resolves quietly — do NOT fire the global tts:complete
        // (it has no requestId and would land on whatever stream started next,
        // disabling its backpressure / truncating its export).
        if (result?.cancelled)
            return "cancelled";
        // Send completion signal
        mainWindow?.webContents.send("tts:complete");
        ttsRequestsThisSession += 1;
        track("tts_synthesis_completed", {
            mode: "quick_speak",
            duration_ms: Date.now() - startedAt,
            text_length_bucket: lengthBucket(typeof text === "string" ? text.length : 0),
            voice_id: voice,
            language: lang,
        });
        return "ok";
    }
    catch (error) {
        if (activeQuickSpeakRequest === requestId)
            activeQuickSpeakRequest = null;
        console.error("[TTS] Streaming error:", error);
        // Forward a richer payload so the renderer can show enough detail for
        // users (especially on Windows) to file a meaningful bug report.
        const payload = `${error.message}\n[${process.platform}/${process.arch}]${error.stack ? `\n${error.stack}` : ""}`;
        mainWindow?.webContents.send("tts:error", payload);
        throw error;
    }
});
// ============ Reader IPC ============
// Open one or more documents via the native dialog. Returns the selected file
// paths (bytes are read on demand via reader:readFile; parsing happens in the
// renderer). Returns null on cancel.
ipcMain.handle("reader:openFiles", async () => {
    if (!mainWindow)
        return null;
    const res = await dialog.showOpenDialog(mainWindow, {
        title: "Open documents",
        properties: ["openFile", "multiSelections"],
        filters: [
            {
                name: "Documents",
                extensions: [
                    "txt",
                    "text",
                    "md",
                    "markdown",
                    "epub",
                    "pdf",
                    "docx",
                    "doc",
                    "mobi",
                    "azw",
                    "azw3",
                    "prc",
                ],
            },
            { name: "All Files", extensions: ["*"] },
        ],
    });
    if (res.canceled || res.filePaths.length === 0)
        return null;
    return res.filePaths.map((p) => ({ path: p, name: path.basename(p) }));
});
// Extract text from a legacy binary Word .doc. word-extractor is Node-only
// (OLE2/CFB binary parsing), so it runs here in the main process and returns
// plain text. Raw parse errors (RangeError on malformed/encrypted files) are
// caught and turned into a friendly message before crossing IPC.
ipcMain.handle("reader:extractDoc", async (_event, bytes) => {
    try {
        const doc = await new WordExtractor().extract(Buffer.from(bytes));
        return { text: doc.getBody() };
    }
    catch {
        return {
            error: "Couldn't read this Word document — it may be corrupt, encrypted, or not a .doc file.",
        };
    }
});
// Re-read a file by path (recents / resume).
ipcMain.handle("reader:readFile", async (_event, filePath) => {
    try {
        const file = readFileForReader(filePath);
        if (!openedPathsThisSession.has(filePath)) {
            openedPathsThisSession.add(filePath);
            docsOpenedThisSession += 1;
        }
        return file;
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});
// Start / cancel windowed generation (fire-and-forget; results stream back as
// reader:* events).
ipcMain.on("reader:generate", (_event, params) => {
    try {
        readerGenerate(params);
    }
    catch (err) {
        mainWindow?.webContents.send("reader:error", {
            requestId: params?.requestId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
});
ipcMain.on("reader:cancel", (_event, requestId) => readerCancel(requestId));
// ---- Quick-speak generation flow control (backpressure) ----
// The renderer caps how far ahead the worker generates, forces full generation
// on Download, and cancels generation on Stop/unmount. All fire-and-forget,
// keyed by the renderer-minted requestId (mirrors reader:cancel).
ipcMain.on("tts:setBufferTarget", (_event, payload) => {
    if (payload?.requestId) {
        ttsWorker?.postMessage({
            type: "setTarget",
            requestId: payload.requestId,
            data: { targetChunk: payload.targetChunk },
        });
    }
});
ipcMain.on("tts:cancel", (_event, requestId) => {
    if (requestId) {
        if (activeQuickSpeakRequest === requestId)
            activeQuickSpeakRequest = null;
        ttsWorker?.postMessage({ type: "cancel", requestId });
    }
});
// Toggle the sidebar: grows/shrinks the window width by ~20%.
ipcMain.handle("app:setSidebar", async (_event, open) => {
    track("sidebar_toggled", { open: !!open });
    setSidebarWindow(open);
});
// Recents (sidebar): files + text "sessions". Text is stored locally only.
ipcMain.handle("reader:recents:get", async () => getRecents());
ipcMain.handle("reader:recents:put", async (_event, entry) => putRecent(entry));
ipcMain.handle("reader:recents:remove", async (_event, key) => removeRecent(key));
// Get app assets
ipcMain.handle("app:asset", async (_event, name) => {
    if (name === "icon") {
        return APP_ICON_BASE64;
    }
    if (name === "lightcloud-logo") {
        return LIGHTCLOUD_LOGO_BASE64;
    }
    return "";
});
// App version (shown in the Help/About panel)
ipcMain.handle("app:version", async () => app.getVersion());
// Handle tray playing state
ipcMain.on("tray:playing", (_event, playing) => {
    if (playing) {
        startTrayAnimation();
    }
    else {
        stopTrayAnimation();
    }
});
// ---- Update notice (GitHub latest release vs running version) ----
// Current available-update info, or null when up to date.
ipcMain.handle("update:get", async () => getUpdate());
// Skip an update version; the banner stays hidden until something newer ships.
ipcMain.handle("update:skip", async (_event, version) => {
    track("update_skipped", { skipped_version: version, current_version: app.getVersion() });
    return skipVersion(version);
});
// Open an external https link in the default browser (download link, release
// page). Validated to http(s) so the renderer can't open arbitrary schemes.
ipcMain.on("app:open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        // Record only the destination domain + a coarse link type — never the full
        // URL (which can carry path/query identifiers).
        try {
            const host = new URL(url).hostname.replace(/^www\./, "");
            const linkType = /github\.com/.test(host)
                ? "github"
                : /buymeacoffee|ko-fi|patreon/.test(host)
                    ? "donate"
                    : /out-loud\.io/.test(host)
                        ? "website"
                        : "other";
            track("external_link_clicked", { domain: host, link_type: linkType });
        }
        catch {
            /* unparsable URL — skip telemetry, still open below */
        }
        shell.openExternal(url);
    }
});
// Renderer-originated usage events. Fire-and-forget; the payload is untrusted —
// telemetry.trackFromRenderer() strips identity/content and re-stamps trusted
// context, so the renderer can neither spoof identity nor smuggle content.
ipcMain.on("telemetry:event", (_event, payload) => {
    trackFromRenderer(payload?.name, payload?.properties);
});
// Handle quit request
ipcMain.on("app:quit", () => {
    isAppQuitting = true;
    if (mainWindow) {
        mainWindow.destroy();
        mainWindow = null;
    }
    app.quit();
});
// ============ App Lifecycle ============
app.whenReady().then(() => {
    // Init telemetry first so app_launched and early events are captured. No-op
    // when not configured / disabled; dev builds send too, tagged is_dev.
    initTelemetry(isDev);
    trackSessionStart();
    createTTSWorker();
    createExtensionServer();
    createTray();
    createWindow();
    preloadModel();
    startUpdateChecks(() => mainWindow);
    app.on("activate", () => {
        if (mainWindow) {
            mainWindow.show();
        }
        else {
            createWindow();
        }
    });
});
app.on("window-all-closed", () => {
    // Don't quit - keep running in tray
});
// Guards against a second before-quit re-entering teardown (e.g. the user
// clicking Quit again during the brief telemetry-flush window before app.exit).
let quitCleanupDone = false;
app.on("before-quit", (event) => {
    // A second before-quit (e.g. the user clicking Quit again during the brief
    // telemetry-flush window) just blocks the default quit and lets the in-flight
    // hard exit complete.
    if (quitCleanupDone) {
        event.preventDefault();
        return;
    }
    quitCleanupDone = true;
    // End the process with app.exit() rather than app.quit(). app.quit() lets
    // Electron free the Node environment, which joins the TTS worker thread
    // (stop_sub_worker_contexts → pthread_join). If the worker is mid ONNX
    // inference, the native ONNX teardown isn't reentrant-safe and the worker
    // aborts → SIGABRT on macOS (this is the "quit while audio is playing" crash).
    // worker.terminate() has the SAME hazard: force-unwinding a worker that's
    // blocked in a synchronous native call crashes the same way. app.exit() skips
    // all of it — it exits immediately, so the OS reclaims the worker thread
    // without running its destructors. Nothing the worker owns needs graceful
    // release (audio is streamed over IPC, never written to disk by the worker).
    event.preventDefault();
    isAppQuitting = true;
    stopUpdateChecks();
    stopTrayAnimation();
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
    // Cooperatively cancel the in-flight quick-speak generation so the worker
    // stops issuing new ONNX runs before we hard-exit (best-effort; an in-flight
    // run can't be interrupted — app.exit() below is the real teardown).
    if (activeQuickSpeakRequest && ttsWorker) {
        ttsWorker.postMessage({ type: "cancel", requestId: activeQuickSpeakRequest });
        activeQuickSpeakRequest = null;
    }
    for (const [, pending] of pendingRequests) {
        pending.reject(new Error("App is shutting down"));
    }
    pendingRequests.clear();
    // Give telemetry a brief, bounded window to flush session_ended (it persists
    // to disk first, so anything unsent is delivered on the next launch), then
    // hard-exit. shutdownTelemetry always resolves, so quit never hangs.
    shutdownTelemetry({
        tts_requests: ttsRequestsThisSession,
        docs_opened: docsOpenedThisSession,
    }).finally(() => app.exit(0));
});
//# sourceMappingURL=main.js.map