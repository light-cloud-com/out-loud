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
    requestId?: string;
    initialTarget?: number;
  }): Promise<string> => {
    return await ipcRenderer.invoke("tts:stream:start", params);
  },

  // Buffer-ahead flow control (quick-speak). Cap how far ahead the worker
  // generates (targetChunk), force full generation (Number.MAX_SAFE_INTEGER),
  // or cancel generation entirely. Fire-and-forget, keyed by requestId.
  setBufferTarget: (requestId: string, targetChunk: number) => {
    ipcRenderer.send("tts:setBufferTarget", { requestId, targetChunk });
  },
  forceFullGeneration: (requestId: string) => {
    ipcRenderer.send("tts:setBufferTarget", { requestId, targetChunk: Number.MAX_SAFE_INTEGER });
  },
  cancelGeneration: (requestId: string) => {
    ipcRenderer.send("tts:cancel", requestId);
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

  // Fire-and-forget anonymous usage event. The main process attaches all
  // identity/context (install id, session, version) and strips anything that
  // isn't shape-only — pass metadata only, never text/content.
  track: (name: string, properties?: Record<string, unknown>) => {
    ipcRenderer.send("telemetry:event", { name, properties });
  },

  // Toggle the sidebar; grows/shrinks the window width by ~20%.
  setSidebar: (open: boolean): Promise<void> => {
    return ipcRenderer.invoke("app:setSidebar", open);
  },

  // ---- Document reader ----
  reader: {
    openFiles: () => ipcRenderer.invoke("reader:openFiles"),
    readFile: (filePath: string) => ipcRenderer.invoke("reader:readFile", filePath),
    extractDoc: (bytes: Uint8Array) => ipcRenderer.invoke("reader:extractDoc", bytes),
    generate: (params: {
      requestId: string;
      units: { id: string; text: string }[];
      voice: string;
    }) => ipcRenderer.send("reader:generate", params),
    cancel: (requestId: string) => ipcRenderer.send("reader:cancel", requestId),
    getRecents: () => ipcRenderer.invoke("reader:recents:get"),
    putRecent: (entry: unknown) => ipcRenderer.invoke("reader:recents:put", entry),
    removeRecent: (key: string) => ipcRenderer.invoke("reader:recents:remove", key),
    onUnitChunk: (
      callback: (data: { requestId: string; unitId: string; base64: string }) => void
    ) => {
      const handler = (_event: unknown, data: unknown) => callback(data as never);
      ipcRenderer.on("reader:unitChunk", handler);
      return () => ipcRenderer.removeListener("reader:unitChunk", handler);
    },
    onUnitDone: (callback: (data: { requestId: string; unitId: string }) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data as never);
      ipcRenderer.on("reader:unitDone", handler);
      return () => ipcRenderer.removeListener("reader:unitDone", handler);
    },
    onComplete: (callback: (data: { requestId: string }) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data as never);
      ipcRenderer.on("reader:genComplete", handler);
      return () => ipcRenderer.removeListener("reader:genComplete", handler);
    },
    onAborted: (callback: (data: { requestId: string }) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data as never);
      ipcRenderer.on("reader:aborted", handler);
      return () => ipcRenderer.removeListener("reader:aborted", handler);
    },
    onError: (callback: (data: { requestId: string; error: string }) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data as never);
      ipcRenderer.on("reader:error", handler);
      return () => ipcRenderer.removeListener("reader:error", handler);
    },
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
        requestId?: string;
        initialTarget?: number;
      }) => Promise<string>;
      setBufferTarget: (requestId: string, targetChunk: number) => void;
      forceFullGeneration: (requestId: string) => void;
      cancelGeneration: (requestId: string) => void;
      onAudioChunk: (
        callback: (data: {
          chunkIndex: number;
          totalChunks: number;
          base64: string;
          requestId?: string;
        }) => void
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
      track: (name: string, properties?: Record<string, unknown>) => void;
      setSidebar: (open: boolean) => Promise<void>;
      isElectron: boolean;
      platform: string;
    };
  }
}
