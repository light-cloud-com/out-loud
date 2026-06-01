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

  // Check if running in Electron
  isElectron: true,

  // Get platform info
  platform: process.platform,
});
