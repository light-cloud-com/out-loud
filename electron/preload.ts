import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Get list of available voices
  getVoices: async (): Promise<{ id: string; name: string; lang: string }[]> => {
    return await ipcRenderer.invoke("tts:voices");
  },

  // Generate streaming TTS - returns a session ID
  generateStreamingTTS: async (params: {
    voice: string;
    text: string;
    speed?: number;
  }): Promise<string> => {
    return await ipcRenderer.invoke("tts:stream:start", params);
  },

  // Listen for audio chunks
  onAudioChunk: (
    callback: (data: { chunkIndex: number; totalChunks: number; base64: string }) => void
  ) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("tts:chunk", handler);
    return () => ipcRenderer.removeListener("tts:chunk", handler);
  },

  // Listen for stream completion
  onStreamComplete: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("tts:complete", handler);
    return () => ipcRenderer.removeListener("tts:complete", handler);
  },

  // Listen for errors
  onError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on("tts:error", handler);
    return () => ipcRenderer.removeListener("tts:error", handler);
  },

  // Notify playing state (for tray animation)
  setPlaying: (playing: boolean) => {
    ipcRenderer.send("tray:playing", playing);
  },

  // Get app assets
  getAsset: async (name: "icon" | "lightcloud-logo"): Promise<string> => {
    return await ipcRenderer.invoke("app:asset", name);
  },

  // Get the app version (for Help/About).
  getAppVersion: async (): Promise<string> => {
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
  updateSettings: async (updates: Record<string, any>) => {
    return await ipcRenderer.invoke("settings:update", updates);
  },

  // Listen for settings updates from other sources (e.g., extension)
  onSettingsUpdated: (callback: (settings: any) => void) => {
    const handler = (_event: any, settings: any) => callback(settings);
    ipcRenderer.on("settings:updated", handler);
    return () => ipcRenderer.removeListener("settings:updated", handler);
  },

  // ---- Update notice ----

  // Get the current available-update info, or null when up to date.
  getUpdate: async (): Promise<UpdateInfo | null> => {
    return await ipcRenderer.invoke("update:get");
  },

  // Listen for update info pushed by the main process after a check.
  onUpdateAvailable: (callback: (update: UpdateInfo | null) => void) => {
    const handler = (_event: any, update: UpdateInfo | null) => callback(update);
    ipcRenderer.on("update:available", handler);
    return () => ipcRenderer.removeListener("update:available", handler);
  },

  // Skip an update version; resolves to the refreshed update info (or null).
  skipVersion: async (version: string): Promise<UpdateInfo | null> => {
    return await ipcRenderer.invoke("update:skip", version);
  },

  // Open an https link in the default browser.
  openExternal: (url: string) => {
    ipcRenderer.send("app:open-external", url);
  },

  // Check if running in Electron
  isElectron: true,

  // Get platform info
  platform: process.platform,
});

// Shared settings interface
interface SharedSettings {
  text: string;
  language: string;
  voice: string;
  volume: number;
  highlightChunk: boolean;
  talkerMode: boolean;
}

// Update info (mirrors electron/update-check.ts)
interface UpdateInfo {
  available: boolean;
  latest: string;
  notesUrl: string;
  downloadUrl: string;
}

// TypeScript declaration for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      getVoices: () => Promise<{ id: string; name: string; lang: string }[]>;
      generateStreamingTTS: (params: {
        voice: string;
        text: string;
        speed?: number;
      }) => Promise<string>;
      onAudioChunk: (
        callback: (data: { chunkIndex: number; totalChunks: number; base64: string }) => void
      ) => () => void;
      onStreamComplete: (callback: () => void) => () => void;
      onError: (callback: (error: string) => void) => () => void;
      setPlaying: (playing: boolean) => void;
      getAsset: (name: "icon" | "lightcloud-logo") => Promise<string>;
      getAppVersion: () => Promise<string>;
      quit: () => void;
      getSettings: () => Promise<SharedSettings>;
      updateSettings: (updates: Partial<SharedSettings>) => Promise<SharedSettings>;
      onSettingsUpdated: (callback: (settings: SharedSettings) => void) => () => void;
      getUpdate: () => Promise<UpdateInfo | null>;
      onUpdateAvailable: (callback: (update: UpdateInfo | null) => void) => () => void;
      skipVersion: (version: string) => Promise<UpdateInfo | null>;
      openExternal: (url: string) => void;
      isElectron: boolean;
      platform: string;
    };
  }
}
