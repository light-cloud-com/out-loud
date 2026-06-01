import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_SETTINGS, DEFAULT_TEXT } from "../constants";

interface Settings {
  text: string;
  language: string;
  voice: string;
  volume: number;
  highlightChunk: boolean;
  talkerMode: boolean;
}

const STORAGE_KEY = "out-loud-settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore parse errors
    }
    // First-ever launch: pre-fill with the example so users see what the app
    // does without having to type anything. After they edit/clear it, the
    // result persists via localStorage — never re-injected as a "fallback"
    // (which would prevent the user from clearing the textarea).
    return { ...DEFAULT_SETTINGS, text: DEFAULT_TEXT };
  });

  const isInitialized = useRef(false);

  // On mount, sync with shared settings from Electron API
  useEffect(() => {
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then((sharedSettings) => {
        if (sharedSettings) {
          setSettings((s) => ({
            ...s,
            text: sharedSettings.text || s.text,
            language: sharedSettings.language || s.language,
            voice: sharedSettings.voice || s.voice,
            volume: sharedSettings.volume ?? s.volume,
            highlightChunk: sharedSettings.highlightChunk ?? s.highlightChunk,
            talkerMode: sharedSettings.talkerMode ?? s.talkerMode,
          }));
        }
        isInitialized.current = true;
      });
    } else {
      isInitialized.current = true;
    }
  }, []);

  // Listen for settings updates from external sources (e.g., extension)
  useEffect(() => {
    if (window.electronAPI?.onSettingsUpdated) {
      const cleanup = window.electronAPI.onSettingsUpdated((sharedSettings) => {
        setSettings((s) => ({
          ...s,
          text: sharedSettings.text ?? s.text,
          language: sharedSettings.language || s.language,
          voice: sharedSettings.voice || s.voice,
          volume: sharedSettings.volume ?? s.volume,
          highlightChunk: sharedSettings.highlightChunk ?? s.highlightChunk,
          talkerMode: sharedSettings.talkerMode ?? s.talkerMode,
        }));
      });
      return cleanup;
    }
  }, []);

  // Save to localStorage and sync to shared settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    // Only sync after initial load to avoid overwriting with defaults
    if (isInitialized.current && window.electronAPI?.updateSettings) {
      window.electronAPI.updateSettings(settings);
    }
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  return { settings, updateSetting };
}
