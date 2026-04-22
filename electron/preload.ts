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
      quit: () => void;
      getSettings: () => Promise<SharedSettings>;
      updateSettings: (updates: Partial<SharedSettings>) => Promise<SharedSettings>;
      onSettingsUpdated: (callback: (settings: SharedSettings) => void) => () => void;
      isElectron: boolean;
      platform: string;
    };
  }
}
