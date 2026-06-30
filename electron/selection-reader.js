import { clipboard, globalShortcut } from "electron";
import { execFile } from "child_process";
// ============ Read-selection hotkey =========================================
// A global keyboard shortcut that reads the current text selection aloud through
// the local engine. Because the shortcut lives in Out Loud (not the other app),
// it works inside ANY application — including the Slack desktop app, which can't
// be extended with a button of our own. No cloud, no Slack plugin: we just grab
// the selected text and speak it locally.
//
// There's no cross-platform API to read another app's selection, so we
// synthesize the OS copy shortcut, read the clipboard, then restore the user's
// previous clipboard:
//   - macOS:   `osascript` → ⌘C        (needs Accessibility permission)
//   - Windows: PowerShell SendKeys ^c
//   - Linux:   `xdotool key ctrl+c`    (X11; needs xdotool installed)
// If the synthesized copy can't run (missing permission/tool), we fall back to
// whatever is already on the clipboard, so "select, copy, hotkey" still works.
// Default accelerator — ⌃⌥S (macOS) / Ctrl+Alt+S (Windows/Linux). Comfier than
// ⌘⌥S and conflict-safe; users can change it in Settings.
export const DEFAULT_READ_ALOUD_SHORTCUT = "Control+Alt+S";
const COPY_SETTLE_MS = 150;
let currentShortcut = DEFAULT_READ_ALOUD_SHORTCUT;
let windowGetter = () => null;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Send the OS "copy" shortcut to the frontmost app. Resolves when the helper
// process exits (by which point the copy has happened); errors are swallowed so
// a missing tool/permission just leaves the clipboard untouched.
function synthesizeCopy() {
    return new Promise((resolve) => {
        let cmd;
        let args;
        if (process.platform === "darwin") {
            cmd = "osascript";
            args = ["-e", 'tell application "System Events" to keystroke "c" using command down'];
        }
        else if (process.platform === "win32") {
            cmd = "powershell";
            args = [
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')",
            ];
        }
        else {
            // Linux (X11). No-ops if xdotool isn't installed.
            cmd = "xdotool";
            args = ["key", "--clearmodifiers", "ctrl+c"];
        }
        execFile(cmd, args, () => resolve());
    });
}
async function readSelection() {
    const before = clipboard.readText();
    await synthesizeCopy();
    await delay(COPY_SETTLE_MS);
    const after = clipboard.readText();
    if (after && after !== before) {
        // Got a fresh selection — use it and put the user's clipboard back.
        clipboard.writeText(before);
        return after.trim();
    }
    // Copy didn't change anything (no selection, or missing permission/tool) —
    // fall back to whatever the user already had on the clipboard.
    return before.trim();
}
// macOS fires globalShortcut on key auto-repeat while the combo is held, which
// would kick off a read per repeat. Guard with an in-flight flag plus a short
// cooldown so one press = one read.
const TRIGGER_COOLDOWN_MS = 800;
let triggering = false;
let lastTriggerAt = 0;
async function onTrigger() {
    const now = Date.now();
    if (triggering || now - lastTriggerAt < TRIGGER_COOLDOWN_MS)
        return;
    triggering = true;
    lastTriggerAt = now;
    try {
        const text = await readSelection();
        if (!text)
            return;
        // Play even when the window is hidden in the tray; don't steal focus from
        // the app the user is reading from (e.g. Slack).
        windowGetter()?.webContents.send("external:speak", { text, source: "shortcut" });
    }
    finally {
        triggering = false;
    }
}
function doRegister(accelerator) {
    if (!accelerator)
        return;
    const ok = globalShortcut.register(accelerator, () => void onTrigger());
    if (!ok) {
        console.warn(`[hotkey] Could not register ${accelerator} (already in use by another app)`);
    }
    else {
        console.log(`[hotkey] Read selection aloud: ${accelerator}`);
    }
}
export function registerSelectionReader(getWindow, accelerator = DEFAULT_READ_ALOUD_SHORTCUT) {
    windowGetter = getWindow;
    currentShortcut = accelerator || DEFAULT_READ_ALOUD_SHORTCUT;
    doRegister(currentShortcut);
}
// Re-register under a new accelerator (called when the user changes it in
// Settings). Falls back to the default for an empty value.
export function setSelectionShortcut(accelerator) {
    const next = accelerator || DEFAULT_READ_ALOUD_SHORTCUT;
    if (next === currentShortcut && globalShortcut.isRegistered(currentShortcut))
        return;
    globalShortcut.unregister(currentShortcut);
    currentShortcut = next;
    doRegister(currentShortcut);
}
// Temporarily release the hotkey while the user is recording a new one, so it
// doesn't fire (or swallow the keys being recorded). resume() re-registers
// whatever the current accelerator is (unchanged on cancel, or the new one once
// Settings saves it).
export function suspendSelectionReader() {
    globalShortcut.unregister(currentShortcut);
}
export function resumeSelectionReader() {
    if (!globalShortcut.isRegistered(currentShortcut))
        doRegister(currentShortcut);
}
export function unregisterSelectionReader() {
    globalShortcut.unregister(currentShortcut);
}
//# sourceMappingURL=selection-reader.js.map