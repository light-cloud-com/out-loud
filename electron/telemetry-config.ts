// ============ Telemetry configuration =======================================
// PostHog Cloud credentials for anonymous, content-free usage analytics.
//
// The PostHog *project API key* (the "phc_..." value) is a PUBLISHABLE,
// write-only ingestion key — PostHog's own docs state it is safe to ship in
// client-side code; it cannot read data back out. A desktop app's key is
// always extractable from the binary, so baking it into the build is the
// normal, accepted approach for client-side telemetry.
//
// Events are sent from the MAIN process (see electron/telemetry.ts), not the
// renderer, so the renderer's VITE_* env vars do not apply here. Override at
// build/runtime with OUT_LOUD_POSTHOG_KEY / OUT_LOUD_POSTHOG_HOST if you'd
// rather not commit the key (note: a packaged app does not inherit your shell
// env at runtime, so for release builds the baked default below is what ships).
//
// Region: this project lives on EU cloud (https://eu.i.posthog.com).

const PLACEHOLDER = "phc_REPLACE_WITH_YOUR_POSTHOG_PROJECT_KEY";

export const POSTHOG_KEY =
  process.env.OUT_LOUD_POSTHOG_KEY || "phc_t7oWYXwnU3VVFgAHibPT9XXV8T5Sc9MweWVAd6hAVToF";
export const POSTHOG_HOST = process.env.OUT_LOUD_POSTHOG_HOST || "https://eu.i.posthog.com";

// True only when a real key has been supplied. If someone strips the key back
// to the placeholder (e.g. an open-source contributor's local build),
// telemetry stays fully disabled — no queue, no network — so nothing breaks
// and nothing is sent.
export function isTelemetryConfigured(): boolean {
  return POSTHOG_KEY.startsWith("phc_") && POSTHOG_KEY !== PLACEHOLDER;
}
