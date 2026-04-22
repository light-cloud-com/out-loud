import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from "electron";
import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { fileURLToPath } from "url";
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
    mainWindow = new BrowserWindow({
        width: 480,
        height: 600,
        minWidth: 400,
        minHeight: 500,
        resizable: true,
        titleBarStyle: "hiddenInset",
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
                shell.openExternal("https://out-loud.pro");
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
            const pending = pendingRequests.get(requestId);
            if (pending) {
                pending.reject(new Error(error));
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
function generateTTS(params, onChunk) {
    return new Promise((resolve, reject) => {
        if (!ttsWorker) {
            reject(new Error("TTS Worker not initialized"));
            return;
        }
        const requestId = crypto.randomUUID();
        pendingRequests.set(requestId, { resolve, reject, onChunk });
        ttsWorker.postMessage({
            type: "generate",
            requestId,
            data: params,
        });
    });
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
function updateSharedSettings(updates) {
    sharedSettings = { ...sharedSettings, ...updates };
    // Notify the renderer about settings change
    mainWindow?.webContents.send("settings:updated", sharedSettings);
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
// Update shared settings
ipcMain.handle("settings:update", async (_event, updates) => {
    return updateSharedSettings(updates);
});
// Start streaming TTS generation
ipcMain.handle("tts:stream:start", async (_event, params) => {
    const { voice, text, speed } = params;
    const lang = getVoiceLang(voice);
    console.log("[TTS] Streaming request:", { voice, lang, textLength: text.length });
    try {
        await generateTTS({
            text,
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
                mainWindow?.webContents.send("tts:chunk", {
                    chunkIndex,
                    totalChunks,
                    base64,
                });
            }
        });
        // Send completion signal
        mainWindow?.webContents.send("tts:complete");
        return "ok";
    }
    catch (error) {
        console.error("[TTS] Streaming error:", error);
        mainWindow?.webContents.send("tts:error", error.message);
        throw error;
    }
});
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
// Handle tray playing state
ipcMain.on("tray:playing", (_event, playing) => {
    if (playing) {
        startTrayAnimation();
    }
    else {
        stopTrayAnimation();
    }
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
    createTTSWorker();
    createExtensionServer();
    createTray();
    createWindow();
    preloadModel();
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
app.on("before-quit", () => {
    isAppQuitting = true;
    // Stop tray animation
    stopTrayAnimation();
    // Close HTTP server
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
    // Clear all pending requests to prevent callbacks during shutdown
    for (const [, pending] of pendingRequests) {
        pending.reject(new Error("App is shutting down"));
    }
    pendingRequests.clear();
    // Terminate worker gracefully - wait for acknowledgment or timeout
    if (ttsWorker) {
        let cleanupDone = false;
        // Listen for shutdown acknowledgment
        const shutdownHandler = (message) => {
            if (message.type === "shutdown_complete") {
                cleanupDone = true;
                console.log("[Main] Worker cleanup complete");
                if (ttsWorker) {
                    ttsWorker.terminate();
                    ttsWorker = null;
                }
            }
        };
        ttsWorker.on("message", shutdownHandler);
        ttsWorker.postMessage({ type: "shutdown" });
        // Force terminate after timeout if worker doesn't respond.
        // Give extra time for LLM native thread to finish its current token.
        setTimeout(() => {
            if (ttsWorker && !cleanupDone) {
                console.log("[Main] Force terminating worker after timeout");
                ttsWorker.terminate();
                ttsWorker = null;
            }
        }, 3000);
    }
});
//# sourceMappingURL=main.js.map