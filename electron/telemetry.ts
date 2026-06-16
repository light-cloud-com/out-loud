import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getOrCreateInstallId } from "./store.js";
import { POSTHOG_KEY, POSTHOG_HOST, isTelemetryConfigured } from "./telemetry-config.js";

// ============ Usage telemetry (PostHog) ======================================
// Anonymous, content-free usage analytics. ONE sender, here in the main
// process: it is the only place that holds the install id, the network
// capability, the batching queue, and the offline spill. The renderer and the
// TTS worker never touch the network — renderer events arrive over a single
// fire-and-forget IPC channel and are re-stamped with trusted context here
// (see trackFromRenderer), so a compromised renderer can't spoof identity.
//
// PRIVACY CONTRACT — what is NEVER sent, under any circumstance:
//   the text being synthesized, document content, sentence text, file names,
//   file paths, document titles, recents entries, full URLs, raw error
//   messages/stack traces, or anything derived from content (including hashes
//   of text — a hash can still confirm known content). Only SHAPE/metadata is
//   allowed: enum voice ids, language codes, bucketed lengths/counts,
//   durations, booleans, formats, platform/arch/version. Property cleaning
//   below is a backstop; callers are expected to pass shape only.
//
// Offline-first is preserved: a network failure is swallowed (mirrors
// update-check.ts), the queue spills to disk and retries later, and nothing
// ever blocks the UI or the app quit.

interface PostHogEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

type Mode = "off" | "live";

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_TIMEOUT_MS = 8_000;
const SHUTDOWN_FLUSH_TIMEOUT_MS = 1_500; // keep quit snappy; spill covers the rest
const MAX_QUEUE = 500; // cap so the offline spill can't grow without bound
const BATCH_MAX = 100; // max events per HTTP request
const FLUSH_AT = 20; // flush eagerly once this many events are buffered

let mode: Mode = "off";
let ctx: {
  installId: string;
  version: string;
  os: string;
  arch: string;
  locale: string;
  sessionId: string;
  isDev: boolean;
} | null = null;

let sessionStart = 0;
let queue: PostHogEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

function spillPath(): string {
  return path.join(app.getPath("userData"), "telemetry-queue.json");
}

function osName(): string {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

// ---- property hygiene -------------------------------------------------------

// Keep only primitive / primitive-array values, and ENFORCE the shape-only
// invariant rather than trusting callers: drop nested objects, reserved/identity
// keys, and — critically — any string longer than a small cap. Every legitimate
// property value here is a short enum, language/voice code, bucket label, format
// or count; an over-long string can only be smuggled content (e.g. a renderer
// calling track('x', { note: entireDocumentText })). So over-long strings and
// over-long arrays are dropped, making the privacy guarantee real, not just a
// caller convention.
const RESERVED = new Set(["distinct_id", "installId", "session_id", "$set"]);
const MAX_STR = 100; // longest legitimate shape value (e.g. a domain) is well under this
const MAX_ARR = 50; // longest legitimate array (changed setting keys) is a handful
function clean(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (RESERVED.has(key) || key.startsWith("$")) continue;
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      if (value.length <= MAX_STR) out[key] = value; // drop over-long = possible content
    } else if (Array.isArray(value)) {
      const arr = value.filter(
        (v) => typeof v === "number" || (typeof v === "string" && v.length <= MAX_STR)
      );
      if (arr.length > 0) out[key] = arr.slice(0, MAX_ARR);
    }
    // everything else (objects, functions, over-long strings) is dropped on purpose
  }
  return out;
}

// ---- public bucketing helpers (shape, never exact content size) -------------

// Bucket a character count into coarse bands so we learn "short vs long" usage
// without ever revealing the exact length of someone's text.
export function lengthBucket(chars: number): string {
  if (chars <= 0) return "0";
  if (chars <= 100) return "1-100";
  if (chars <= 500) return "101-500";
  if (chars <= 2000) return "501-2k";
  if (chars <= 10000) return "2k-10k";
  return "10k+";
}

// Bucket a page/sentence/unit count.
export function countBucket(n: number): string {
  if (n <= 0) return "0";
  if (n <= 50) return "1-50";
  if (n <= 200) return "51-200";
  if (n <= 1000) return "201-1k";
  return "1k+";
}

// ---- init / persistence -----------------------------------------------------

export function initTelemetry(isDev: boolean): void {
  // Hard kill-switch (invisible to users; for emergencies / contributor builds).
  if (process.env.OUT_LOUD_TELEMETRY_DISABLED) {
    mode = "off";
    return;
  }
  if (!isTelemetryConfigured()) {
    mode = "off";
    return;
  }

  ctx = {
    installId: getOrCreateInstallId(),
    version: app.getVersion(),
    os: osName(),
    arch: process.arch,
    locale: app.getLocale() || "unknown",
    sessionId: crypto.randomUUID(),
    isDev,
  };
  sessionStart = Date.now();

  // Always send when configured (including dev builds). Dev sessions are still
  // distinguishable in PostHog via the is_dev event property, so they can be
  // filtered out of production metrics if desired without being dropped here.
  mode = "live";

  loadSpill();
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  // Don't let the interval keep the process alive / block exit.
  flushTimer.unref?.();
}

function loadSpill(): void {
  try {
    const raw = fs.readFileSync(spillPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      queue = parsed.slice(-MAX_QUEUE);
    }
  } catch {
    // No spill or unreadable — start empty.
  }
}

function persistSpill(): void {
  try {
    if (queue.length === 0) {
      fs.rmSync(spillPath(), { force: true });
    } else {
      fs.writeFileSync(spillPath(), JSON.stringify(queue), "utf-8");
    }
  } catch {
    // Disk full / permissions — best-effort, never throw into the app.
  }
}

// ---- track ------------------------------------------------------------------

function enqueue(event: string, props: Record<string, unknown>): void {
  if (!ctx) return;
  const payload: PostHogEvent = {
    event,
    distinct_id: ctx.installId,
    timestamp: new Date().toISOString(),
    properties: {
      ...clean(props),
      // PostHog's /batch/ endpoint reads distinct_id from inside properties;
      // the top-level field above is belt-and-suspenders for the SDK format.
      distinct_id: ctx.installId,
      session_id: ctx.sessionId,
      app_version: ctx.version,
      os: ctx.os,
      arch: ctx.arch,
      locale: ctx.locale,
      is_dev: ctx.isDev,
      // PostHog-recognised props for nicer built-in breakdowns.
      $os: ctx.os,
      $app_version: ctx.version,
      $lib: "out-loud-desktop",
      $lib_version: ctx.version,
      // Person-level properties on the anonymous install.
      $set: { app_version: ctx.version, os: ctx.os, arch: ctx.arch, locale: ctx.locale },
    },
  };

  queue.push(payload);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE); // drop oldest
  if (queue.length >= FLUSH_AT) void flush();
}

// Main-process callers (lifecycle, worker, HTTP API). Trusted context is
// stamped in enqueue(); pass shape-only props.
export function track(event: string, props?: Record<string, unknown>): void {
  if (mode === "off") return;
  try {
    enqueue(event, props || {});
  } catch {
    // Telemetry must never break the app.
  }
}

// Renderer-originated events arriving over IPC. Identical to track() but the
// payload is treated as fully untrusted: clean() already strips identity and
// non-primitive values, and enqueue() re-stamps trusted context, so a renderer
// can neither spoof the install/session id nor smuggle content through.
export function trackFromRenderer(event: unknown, props: unknown): void {
  if (mode === "off") return;
  if (typeof event !== "string" || event.length === 0 || event.length > 80) return;
  const safeProps =
    props && typeof props === "object" && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : {};
  track(event, safeProps);
}

// ---- session ----------------------------------------------------------------

export function trackSessionStart(): void {
  track("app_launched", {});
}

function sessionEndedProps(extra?: Record<string, unknown>): Record<string, unknown> {
  return { session_duration_ms: sessionStart ? Date.now() - sessionStart : 0, ...extra };
}

// ---- flush / shutdown -------------------------------------------------------

async function flush(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  if (mode !== "live") return;
  if (flushing || queue.length === 0) return;
  flushing = true;
  // Remove the batch from the queue UP FRONT so a concurrent enqueue() during
  // the await (which may drop from the front when MAX_QUEUE is exceeded) can't
  // shift positions under us. On failure we put the batch back at the front.
  const batch = queue.splice(0, BATCH_MAX);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
    });
    if (!res.ok) throw new Error(`PostHog returned ${res.status}`);
    // Success: the batch is already removed; just persist the remaining queue.
    persistSpill();
  } catch {
    // Offline / blocked / timed out — put the unsent events back at the front
    // (re-capping to MAX_QUEUE) and persist so they survive a quit/crash and
    // retry on the next launch.
    queue.unshift(...batch);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persistSpill();
  } finally {
    clearTimeout(timer);
    flushing = false;
  }
}

// Final flush on quit. Records session_ended, persists immediately (so nothing
// is lost even if the network hangs), then makes a short best-effort send.
// Always resolves; never blocks quit beyond the timeout.
export async function shutdownTelemetry(extra?: Record<string, unknown>): Promise<void> {
  if (mode === "off") return;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try {
    enqueue("session_ended", sessionEndedProps(extra));
  } catch {
    /* ignore */
  }
  if (mode !== "live") return;
  persistSpill();
  try {
    await flush(SHUTDOWN_FLUSH_TIMEOUT_MS);
  } catch {
    /* never throw on the quit path */
  }
}
