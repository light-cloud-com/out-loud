// Platform detection. electronAPI.platform is process.platform
// ("darwin" | "win32" | "linux"); fall back to navigator.platform in the browser.
const p = (window.electronAPI?.platform ?? "").toLowerCase();
const nav = (navigator.platform ?? "").toLowerCase();

export const IS_MAC = p ? p === "darwin" : nav.includes("mac");
export const IS_WINDOWS = p ? p.startsWith("win") : nav.includes("win");
export const IS_LINUX = !IS_MAC && !IS_WINDOWS;
