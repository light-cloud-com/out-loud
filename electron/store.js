import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
const DEFAULT_PREFS = {
    skippedVersion: null,
    lastCheckAt: 0,
};
let cache = null;
function prefsPath() {
    return path.join(app.getPath("userData"), "preferences.json");
}
export function getPrefs() {
    if (cache)
        return cache;
    try {
        const raw = fs.readFileSync(prefsPath(), "utf-8");
        cache = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    }
    catch {
        // Missing or corrupt file → fall back to defaults (and don't write yet;
        // the first setPrefs() call materialises the file).
        cache = { ...DEFAULT_PREFS };
    }
    return cache;
}
export function setPrefs(updates) {
    const next = { ...getPrefs(), ...updates };
    cache = next;
    try {
        fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2), "utf-8");
    }
    catch (err) {
        console.error("[Prefs] Failed to persist preferences:", err);
    }
    return next;
}
//# sourceMappingURL=store.js.map