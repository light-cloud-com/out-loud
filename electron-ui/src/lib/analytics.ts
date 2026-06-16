// Renderer-side usage analytics — a thin, safe wrapper over the main-process
// telemetry sender exposed through preload (window.electronAPI.track).
//
// All identity and context (anonymous install id, session, app version,
// platform) are attached in the MAIN process, and the main process strips any
// non-shape values before sending. Here we only forward shape-only metadata.
// NEVER pass text being read, file names, document titles, or any content —
// counts, buckets, enums, booleans and durations only.
//
// In the browser/dev-serve target (no Electron) window.electronAPI is
// undefined, so every call is a harmless no-op.

export function track(event: string, properties?: Record<string, unknown>): void {
  try {
    window.electronAPI?.track?.(event, properties ?? {});
  } catch {
    // Analytics must never break the UI.
  }
}

// These mirror electron/telemetry.ts so the renderer and main process bucket
// identically. The two processes can't share a module (separate build graphs),
// so keep these in sync if you change the bands.

// Bucket a character count into coarse bands — "short vs long" without ever
// revealing the exact length of someone's text.
export function lengthBucket(chars: number): string {
  if (chars <= 0) return "0";
  if (chars <= 100) return "1-100";
  if (chars <= 500) return "101-500";
  if (chars <= 2000) return "501-2k";
  if (chars <= 10000) return "2k-10k";
  return "10k+";
}

// Bucket a page / sentence / unit count.
export function countBucket(n: number): string {
  if (n <= 0) return "0";
  if (n <= 50) return "1-50";
  if (n <= 200) return "51-200";
  if (n <= 1000) return "201-1k";
  return "1k+";
}
