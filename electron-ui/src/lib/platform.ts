// Platform detection. electronAPI.platform is process.platform
// ("darwin" | "win32" | "linux"); fall back to navigator.platform in the browser.
const p = (window.electronAPI?.platform ?? "").toLowerCase();
const nav = (navigator.platform ?? "").toLowerCase();

export const IS_MAC = p ? p === "darwin" : nav.includes("mac");
