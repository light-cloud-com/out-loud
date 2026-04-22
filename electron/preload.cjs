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

  // Check if running in Electron
  isElectron: true,

  // Get platform info
  platform: process.platform,
});
