import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
const MAX_RECENTS = 24;
function recentsPath() {
    return path.join(app.getPath("userData"), "reader-recents.json");
}
// Stable identity per entry: file→path, session→id.
function keyOf(e) {
    return e.kind === "text" ? `text:${e.id}` : `file:${e.path}`;
}
// Normalize legacy entries (pre-unification) — they had no `kind` and a
// `lastSentenceIndex`; treat any entry with a `path` and no kind as a file.
function normalize(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const e = raw;
    if (e.kind === "text") {
        if (typeof e.id !== "string" || typeof e.text !== "string")
            return null;
        return {
            kind: "text",
            id: e.id,
            text: e.text,
            preview: typeof e.preview === "string" ? e.preview : String(e.text).slice(0, 80),
            voice: typeof e.voice === "string" ? e.voice : undefined,
            language: typeof e.language === "string" ? e.language : undefined,
            addedAt: typeof e.addedAt === "number" ? e.addedAt : 0,
        };
    }
    if (typeof e.path === "string") {
        return {
            kind: "file",
            path: e.path,
            name: typeof e.name === "string" ? e.name : e.path,
            title: typeof e.title === "string" ? e.title : String(e.name ?? e.path),
            format: typeof e.format === "string" ? e.format : "txt",
            addedAt: typeof e.addedAt === "number" ? e.addedAt : 0,
        };
    }
    return null;
}
export function getRecents() {
    try {
        const raw = fs.readFileSync(recentsPath(), "utf-8");
        const list = JSON.parse(raw);
        if (!Array.isArray(list))
            return [];
        return list.map(normalize).filter((e) => e !== null);
    }
    catch {
        return [];
    }
}
function write(list) {
    const trimmed = list.slice(0, MAX_RECENTS);
    try {
        fs.writeFileSync(recentsPath(), JSON.stringify(trimmed, null, 2), "utf-8");
    }
    catch (err) {
        console.error("[Recents] Failed to persist recents:", err);
    }
    return trimmed;
}
export function putRecent(entry) {
    const e = normalize(entry);
    if (!e)
        return getRecents();
    const k = keyOf(e);
    // Dedupe by identity, and additionally collapse identical text sessions so
    // replaying the same text doesn't pile up duplicates.
    const list = getRecents().filter((r) => {
        if (keyOf(r) === k)
            return false;
        if (e.kind === "text" && r.kind === "text" && r.text === e.text)
            return false;
        return true;
    });
    list.unshift(e);
    return write(list);
}
export function removeRecent(key) {
    return write(getRecents().filter((r) => keyOf(r) !== key));
}
//# sourceMappingURL=reader-recents.js.map