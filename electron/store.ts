import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// Persisted main-process store. Renderer settings live in localStorage (see
// electron-ui/src/hooks/useSettings.ts), but these prefs are read in the main
// process (during the update check), so they belong on disk in userData.
export interface AppPrefs {
  // A version the user chose to skip; the update banner stays hidden until a
  // version newer than this ships.
  skippedVersion: string | null;
  // Epoch ms of the last update check.
  lastCheckAt: number;
}

const DEFAULT_PREFS: AppPrefs = {
  skippedVersion: null,
  lastCheckAt: 0,
};

let cache: AppPrefs | null = null;

function prefsPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

export function getPrefs(): AppPrefs {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(prefsPath(), "utf-8");
    cache = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    // Missing or corrupt file → fall back to defaults (and don't write yet;
    // the first setPrefs() call materialises the file).
    cache = { ...DEFAULT_PREFS };
  }
  return cache;
}

export function setPrefs(updates: Partial<AppPrefs>): AppPrefs {
  const next = { ...getPrefs(), ...updates };
  cache = next;
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2), "utf-8");
  } catch (err) {
    console.error("[Prefs] Failed to persist preferences:", err);
  }
  return next;
}
