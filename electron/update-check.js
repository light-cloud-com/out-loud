import { app } from "electron";
import { getPrefs, setPrefs } from "./store.js";
import { track } from "./telemetry.js";
const RELEASES_API = "https://api.github.com/repos/light-cloud-com/out-loud/releases/latest";
const RELEASES_URL = "https://github.com/light-cloud-com/out-loud/releases/latest";
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 8000;
let cachedUpdate = null;
let lastAnnounced = null;
let pollTimer = null;
let windowGetter = () => null;
// ---- pure helpers -----------------------------------------------------------
// "v1.2.3" / "1.2.3" → [1, 2, 3]
function parseVersion(v) {
    return v
        .replace(/^v/i, "")
        .split(".")
        .map((n) => parseInt(n, 10) || 0);
}
// -1 if a < b, 0 if equal, 1 if a > b
function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da > db)
            return 1;
        if (da < db)
            return -1;
    }
    return 0;
}
// Pick the installer asset matching this OS + architecture. electron-builder
// tags arm64 assets with "arm64" in the filename; x64 assets carry no arch
// tag, so we select by presence/absence of "arm64".
function pickAsset(assets) {
    const isArm = process.arch === "arm64";
    const ext = process.platform === "darwin" ? ".dmg" : process.platform === "win32" ? ".exe" : ".AppImage";
    const candidates = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
    const match = candidates.find((a) => (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name)));
    return (match || candidates[0])?.browser_download_url || "";
}
// ---- network + state --------------------------------------------------------
export function getUpdate() {
    return cachedUpdate;
}
async function fetchLatestRelease() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(RELEASES_API, {
            signal: controller.signal,
            // GitHub requires a User-Agent; the JSON accept header pins the API version.
            headers: { Accept: "application/vnd.github+json", "User-Agent": "out-loud-app" },
            cache: "no-cache",
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        if (!data.tag_name)
            return null;
        return {
            tag: data.tag_name,
            notesUrl: data.html_url || RELEASES_URL,
            assets: data.assets || [],
        };
    }
    catch {
        // Offline, blocked, rate-limited, or timed out — stay silent.
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
function computeUpdate(release) {
    const latest = release.tag.replace(/^v/i, "");
    const version = app.getVersion();
    // Only announce a strictly newer version.
    if (compareVersions(latest, version) <= 0)
        return null;
    const skipped = getPrefs().skippedVersion;
    if (skipped && compareVersions(latest, skipped) <= 0)
        return null;
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
    if (!release)
        return;
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
export function startUpdateChecks(getWindow) {
    windowGetter = getWindow;
    // App Store builds must not advertise their own updates — the store owns
    // distribution there (process.mas is set only in MAS builds).
    if (process.mas)
        return;
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
export function skipVersion(version) {
    setPrefs({ skippedVersion: version });
    if (cachedUpdate && compareVersions(cachedUpdate.latest, version) <= 0) {
        cachedUpdate = null;
    }
    return cachedUpdate;
}
//# sourceMappingURL=update-check.js.map