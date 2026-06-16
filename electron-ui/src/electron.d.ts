interface SharedSettings {
  text: string;
  language: string;
  voice: string;
  volume: number;
  highlightChunk: boolean;
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
  track: (name: string, properties?: Record<string, unknown>) => void;
  setSidebar: (open: boolean) => Promise<void>;
  reader: ReaderApi;
  isElectron: boolean;
  platform: string;
}

declare global {
  // Reader DTOs are global so the reader modules can reference them directly.
  interface ReaderFile {
    path: string;
    name: string;
    bytes: ArrayBuffer;
  }

  interface ReaderFileError {
    error: string;
  }

  // Sidebar recents: a file the user opened, or a text "session" they listened
  // to. Text sessions store the full text LOCALLY ONLY (never sent anywhere).
  interface RecentFile {
    kind: "file";
    path: string;
    name: string;
    title: string;
    format: string;
    addedAt: number;
  }

  interface RecentSession {
    kind: "text";
    id: string;
    preview: string;
    text: string;
    voice?: string;
    language?: string;
    addedAt: number;
  }

  type RecentEntry = RecentFile | RecentSession;

  interface ReaderGenerateParams {
    requestId: string;
    units: { id: string; text: string }[];
    voice: string;
  }

  interface ReaderApi {
    openFiles: () => Promise<Array<{ path: string; name: string }> | null>;
    readFile: (filePath: string) => Promise<ReaderFile | ReaderFileError | null>;
    extractDoc: (bytes: Uint8Array) => Promise<{ text: string } | { error: string }>;
    generate: (params: ReaderGenerateParams) => void;
    cancel: (requestId: string) => void;
    getRecents: () => Promise<RecentEntry[]>;
    putRecent: (entry: RecentEntry) => Promise<RecentEntry[]>;
    removeRecent: (key: string) => Promise<RecentEntry[]>;
    onUnitChunk: (
      cb: (data: { requestId: string; unitId: string; base64: string }) => void
    ) => () => void;
    onUnitDone: (cb: (data: { requestId: string; unitId: string }) => void) => () => void;
    onComplete: (cb: (data: { requestId: string }) => void) => () => void;
    onAborted: (cb: (data: { requestId: string }) => void) => () => void;
    onError: (cb: (data: { requestId: string; error: string }) => void) => () => void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
