// Append-only startup/crash breadcrumb log, shared by the main process and the
// TTS worker thread.
//
// Why this exists: onnxruntime segfaulting inside InferenceSession.create took
// the whole process down with no JS error, no crash report and no log — the app
// just vanished ~3s after launch, and three separate users (#36/#37/#38) had to
// reverse-engineer it from OS crash reports. Anything buffered would have been
// lost with the process, so EVERY write here is synchronous: the line is on
// disk before the next statement runs, and the last line before a hard native
// abort survives. That makes the final breadcrumb the crash location.
//
// Logging must never be the thing that breaks startup, so every entry point is
// wrapped — a failure to log degrades to silence, never to a throw.
import { appendFileSync, mkdirSync, renameSync, statSync } from "fs";
import * as path from "path";
import { format } from "util";
// Rotate at 2 MB, keeping one previous file. Enough to cover many launches
// while staying small enough to paste into an issue.
const MAX_BYTES = 2 * 1024 * 1024;
let logPath = null;
function write(line) {
    if (!logPath)
        return;
    try {
        appendFileSync(logPath, line);
    }
    catch {
        // Disk full, permissions, sandbox denial — logging is best-effort.
    }
}
function timestamp() {
    return new Date().toISOString();
}
// Rotate BEFORE the session header so a session is never split across files.
function rotateIfLarge(file) {
    try {
        if (statSync(file).size >= MAX_BYTES)
            renameSync(file, `${file}.1`);
    }
    catch {
        // Missing file (first run) is the normal case.
    }
}
/**
 * Open the log and start a new session. Call once, from the main process only —
 * this is what rotates the file and writes the session header. Returns the
 * resolved path, or null if the log could not be opened.
 */
export function initCrashLog(file, header = {}) {
    if (logPath)
        return logPath;
    try {
        mkdirSync(path.dirname(file), { recursive: true });
        rotateIfLarge(file);
        logPath = file;
        const fields = Object.entries(header)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        write(`\n=== session ${timestamp()} ${fields}\n`);
        return logPath;
    }
    catch {
        logPath = null;
        return null;
    }
}
/**
 * Join the session already opened by the main process. For worker threads,
 * which get their own copy of this module's state but must not start a second
 * session: re-running the header would read as a fresh launch, and re-running
 * rotation could rename the file out from under the main thread mid-session.
 */
export function attachCrashLog(file) {
    if (logPath)
        return;
    logPath = file;
}
export function getCrashLogPath() {
    return logPath;
}
/** Write one breadcrumb. `scope` groups lines by origin, e.g. "main"/"worker". */
export function logLine(scope, ...args) {
    let msg;
    try {
        msg = format(...args);
    }
    catch {
        msg = "<unformattable>";
    }
    write(`${timestamp()} [${scope}] ${msg}\n`);
}
/**
 * Mirror console.log/warn/error into the log, keeping normal console output
 * intact. The app already emits the breadcrumbs that matter ("ONNX session
 * providers: cpu", "Model preloaded successfully") — this captures them for
 * packaged builds, where stdout goes nowhere the user can see.
 */
export function teeConsole(scope) {
    const levels = ["log", "warn", "error"];
    for (const level of levels) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            logLine(level === "log" ? scope : `${scope}:${level}`, ...args);
            original(...args);
        };
    }
}
/**
 * Record the failure modes that would otherwise leave no trace. Native aborts
 * can't be caught in JS at all — those are covered by the synchronous writes
 * above plus crashReporter minidumps — but everything catchable lands here.
 */
export function installProcessHandlers(scope) {
    process.on("uncaughtException", (err) => {
        logLine(`${scope}:fatal`, "uncaughtException:", err?.stack || err);
    });
    process.on("unhandledRejection", (reason) => {
        logLine(`${scope}:fatal`, "unhandledRejection:", reason?.stack ?? reason);
    });
    process.on("exit", (code) => {
        logLine(scope, `process exit code=${code}`);
    });
}
//# sourceMappingURL=crash-log.js.map