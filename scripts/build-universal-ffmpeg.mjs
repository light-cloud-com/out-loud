#!/usr/bin/env node
// Make node_modules/ffmpeg-static/ffmpeg a universal (x86_64 + arm64) binary.
//
// ffmpeg-static ships a single per-host-arch binary, but the Mac App Store
// build is universal. @electron/universal skips lipo for binaries that are
// already fat, so the cleanest fix is to fatten ffmpeg on disk BEFORE the
// universal MAS build (an arm64-only ffmpeg would otherwise fail the merge,
// since it'd be an identical single-arch Mach-O in both sub-builds).
//
// Idempotent: exits early if ffmpeg is already universal. macOS-only.
//
//   node scripts/build-universal-ffmpeg.mjs

import { execFileSync } from "node:child_process";
import { chmodSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "darwin") {
  console.log("• Not macOS — skipping universal ffmpeg step.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const tag = require("ffmpeg-static/package.json")["ffmpeg-static"]["binary-release-tag"];

function archsOf(file) {
  return execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/);
}

const archs = archsOf(ffmpegPath);
if (archs.includes("x86_64") && archs.includes("arm64")) {
  console.log(`• ffmpeg already universal (${archs.join(", ")}) — nothing to do.`);
  process.exit(0);
}

// ffmpeg-static asset arch names: "x64" / "arm64". lipo reports x86_64/arm64.
const haveArm = archs.includes("arm64");
const missingAsset = haveArm ? "ffmpeg-darwin-x64" : "ffmpeg-darwin-arm64";
const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/${missingAsset}`;

console.log(`• ffmpeg is ${archs.join(", ")}-only; fetching ${missingAsset} (${tag})…`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
const missingBin = join(tmpdir(), missingAsset);
writeFileSync(missingBin, Buffer.from(await res.arrayBuffer()));

const merged = join(dirname(ffmpegPath), "ffmpeg.universal");
execFileSync("lipo", ["-create", ffmpegPath, missingBin, "-output", merged]);
renameSync(merged, ffmpegPath);
chmodSync(ffmpegPath, 0o755);

console.log(`• ffmpeg is now universal (${archsOf(ffmpegPath).join(", ")}).`);
