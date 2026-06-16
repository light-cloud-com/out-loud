const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Get list of available voices
  getVoices: async () => {
    return await ipcRenderer.invoke("tts:voices");
  },

  // Generate streaming TTS - returns a session ID
  generateStreamingTTS: async (params) => {
    return await ipcRenderer.invoke("tts:stream:start", params);
  },

  // Buffer-ahead flow control (quick-speak), fire-and-forget, keyed by requestId.
  setBufferTarget: (requestId, targetChunk) => {
    ipcRenderer.send("tts:setBufferTarget", { requestId, targetChunk });
  },
  forceFullGeneration: (requestId) => {
    ipcRenderer.send("tts:setBufferTarget", { requestId, targetChunk: Number.MAX_SAFE_INTEGER });
  },
  cancelGeneration: (requestId) => {
    ipcRenderer.send("tts:cancel", requestId);
  },

  // Listen for audio chunks
  onAudioChunk: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tts:chunk", handler);
    return () => ipcRenderer.removeListener("tts:chunk", handler);
  },

  // Listen for stream completion
  onStreamComplete: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("tts:complete", handler);
    return () => ipcRenderer.removeListener("tts:complete", handler);
  },

  // Listen for errors
  onError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on("tts:error", handler);
    return () => ipcRenderer.removeListener("tts:error", handler);
  },

  // Notify playing state (for tray animation)
  setPlaying: (playing) => {
    ipcRenderer.send("tray:playing", playing);
  },

  // Get app assets
  getAsset: async (name) => {
    return await ipcRenderer.invoke("app:asset", name);
  },

  // Get the app version (for Help/About).
  getAppVersion: async () => {
    return await ipcRenderer.invoke("app:version");
  },

  // Quit the app
  quit: () => {
    ipcRenderer.send("app:quit");
  },

  // Get shared settings
  getSettings: async () => {
    return await ipcRenderer.invoke("settings:get");
  },

  // Update shared settings
  updateSettings: async (updates) => {
    return await ipcRenderer.invoke("settings:update", updates);
  },

  // Listen for settings updates from other sources (e.g., extension)
  onSettingsUpdated: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:updated", handler);
    return () => ipcRenderer.removeListener("settings:updated", handler);
  },

  // ---- Update notice ----

  // Get the current available-update info, or null when up to date.
  getUpdate: async () => {
    return await ipcRenderer.invoke("update:get");
  },

  // Listen for update info pushed by the main process after a check.
  onUpdateAvailable: (callback) => {
    const handler = (_event, update) => callback(update);
    ipcRenderer.on("update:available", handler);
    return () => ipcRenderer.removeListener("update:available", handler);
  },

  // Skip an update version; resolves to the refreshed update info (or null).
  skipVersion: async (version) => {
    return await ipcRenderer.invoke("update:skip", version);
  },

  // Open an https link in the default browser.
  openExternal: (url) => {
    ipcRenderer.send("app:open-external", url);
  },

  // Fire-and-forget anonymous usage event. The main process attaches all
  // identity/context and strips anything that isn't shape-only — pass metadata
  // only, never text/content.
  track: (name, properties) => {
    ipcRenderer.send("telemetry:event", { name, properties });
  },

  // Toggle the sidebar; grows/shrinks the window width by ~20%.
  setSidebar: (open) => {
    return ipcRenderer.invoke("app:setSidebar", open);
  },

  // ---- Document reader ----
  reader: {
    openFiles: () => ipcRenderer.invoke("reader:openFiles"),
    readFile: (filePath) => ipcRenderer.invoke("reader:readFile", filePath),
    extractDoc: (bytes) => ipcRenderer.invoke("reader:extractDoc", bytes),
    generate: (params) => ipcRenderer.send("reader:generate", params),
    cancel: (requestId) => ipcRenderer.send("reader:cancel", requestId),
    getRecents: () => ipcRenderer.invoke("reader:recents:get"),
    putRecent: (entry) => ipcRenderer.invoke("reader:recents:put", entry),
    removeRecent: (key) => ipcRenderer.invoke("reader:recents:remove", key),
    onUnitChunk: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("reader:unitChunk", handler);
      return () => ipcRenderer.removeListener("reader:unitChunk", handler);
    },
    onUnitDone: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("reader:unitDone", handler);
      return () => ipcRenderer.removeListener("reader:unitDone", handler);
    },
    onComplete: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("reader:genComplete", handler);
      return () => ipcRenderer.removeListener("reader:genComplete", handler);
    },
    onAborted: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("reader:aborted", handler);
      return () => ipcRenderer.removeListener("reader:aborted", handler);
    },
    onError: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("reader:error", handler);
      return () => ipcRenderer.removeListener("reader:error", handler);
    },
  },

  // Check if running in Electron
  isElectron: true,

  // Get platform info
  platform: process.platform,
});
