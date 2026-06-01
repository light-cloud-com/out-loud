interface SharedSettings {
  text: string;
  language: string;
  voice: string;
  volume: number;
  highlightChunk: boolean;
  talkerMode: boolean;
}

interface UpdateInfo {
  available: boolean;
  latest: string;
  notesUrl: string;
  downloadUrl: string;
}

interface ElectronAPI {
  getVoices: () => Promise<Array<{ id: string; name: string; lang: string }>>;
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
  getAsset: (name: string) => Promise<string>;
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
