import { app, BrowserWindow } from "electron";
import { getPrefs, setPrefs } from "./store.js";
import { track } from "./telemetry.js";

// ============ Update check ===================================================
// Polls GitHub's "latest release" and, when it's newer than the running
// version, surfaces an in-app "update available" notice with a direct download
// link for this platform. No backend/manifest — the source of truth is the
// GitHub Releases API. Best-effort: any network failure is swallowed so the
// offline-first app keeps working exactly as before.

export interface UpdateInfo {
  available: boolean;
  latest: string;
  notesUrl: string;
  downloadUrl: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

const RELEASES_API = "https://api.github.com/repos/light-cloud-com/out-loud/releases/latest";
const RELEASES_URL = "https://github.com/light-cloud-com/out-loud/releases/latest";
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 8000;

let cachedUpdate: UpdateInfo | null = null;
let lastAnnounced: string | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let windowGetter: () => BrowserWindow | null = () => null;

// ---- pure helpers -----------------------------------------------------------

// "v1.2.3" / "1.2.3" → [1, 2, 3]
function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

// -1 if a < b, 0 if equal, 1 if a > b
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// Pick the installer asset matching this OS + architecture. electron-builder
// tags arm64 assets with "arm64" in the filename; x64 assets carry no arch
// tag, so we select by presence/absence of "arm64".
function pickAsset(assets: GithubAsset[]): string {
  const isArm = process.arch === "arm64";
  const ext =
    process.platform === "darwin" ? ".dmg" : process.platform === "win32" ? ".exe" : ".AppImage";
  const candidates = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
  const match = candidates.find((a) => (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name)));
  return (match || candidates[0])?.browser_download_url || "";
}

// ---- network + state --------------------------------------------------------

export function getUpdate(): UpdateInfo | null {
  return cachedUpdate;
}

async function fetchLatestRelease(): Promise<{
  tag: string;
  notesUrl: string;
  assets: GithubAsset[];
} | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API, {
      signal: controller.signal,
      // GitHub requires a User-Agent; the JSON accept header pins the API version.
      headers: { Accept: "application/vnd.github+json", "User-Agent": "out-loud-app" },
      cache: "no-cache",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: GithubAsset[];
    };
    if (!data.tag_name) return null;
    return {
      tag: data.tag_name,
      notesUrl: data.html_url || RELEASES_URL,
      assets: data.assets || [],
    };
  } catch {
    // Offline, blocked, rate-limited, or timed out — stay silent.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function computeUpdate(release: {
  tag: string;
  notesUrl: string;
  assets: GithubAsset[];
}): UpdateInfo | null {
  const latest = release.tag.replace(/^v/i, "");
  const version = app.getVersion();
  // Only announce a strictly newer version.
  if (compareVersions(latest, version) <= 0) return null;
  const skipped = getPrefs().skippedVersion;
  if (skipped && compareVersions(latest, skipped) <= 0) return null;
  return {
    available: true,
    latest,
    notesUrl: release.notesUrl,
    downloadUrl: pickAsset(release.assets) || release.notesUrl,
  };
}

function broadcast() {
  windowGetter()?.webContents.send("update:available", cachedUpdate);
}

async function refresh() {
  const release = await fetchLatestRelease();
  setPrefs({ lastCheckAt: Date.now() });
  if (!release) return;
  cachedUpdate = computeUpdate(release);
  // Announce once per newly-detected version (the poll runs every 6h).
  if (cachedUpdate && cachedUpdate.latest !== lastAnnounced) {
    lastAnnounced = cachedUpdate.latest;
    track("update_available", {
      latest_version: cachedUpdate.latest,
      current_version: app.getVersion(),
    });
  }
  broadcast();
}

export function startUpdateChecks(getWindow: () => BrowserWindow | null) {
  windowGetter = getWindow;
  // App Store builds must not advertise their own updates — the store owns
  // distribution there (process.mas is set only in MAS builds).
  if ((process as { mas?: boolean }).mas) return;
  // Delay the first check so it never competes with startup / model preload.
  setTimeout(() => void refresh(), 5000);
  pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
}

export function stopUpdateChecks() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Skip an update version; the banner stays hidden until something newer ships.
export function skipVersion(version: string): UpdateInfo | null {
  setPrefs({ skippedVersion: version });
  if (cachedUpdate && compareVersions(cachedUpdate.latest, version) <= 0) {
    cachedUpdate = null;
  }
  return cachedUpdate;
}
