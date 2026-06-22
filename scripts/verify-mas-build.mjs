#!/usr/bin/env node
// Post-build sandbox smoke-test for the Mac App Store build.
//
//   node scripts/verify-mas-build.mjs                 # auto-find the mas .app
//   node scripts/verify-mas-build.mjs path/to/App.app # explicit
//   npm run verify:mas
//
// MAS uploads fail in App Store Connect AFTER a slow Transporter round-trip, so
// this catches the common rejections locally in seconds. It does NOT run the
// app inside the real sandbox (that needs an installed .pkg) — it statically
// asserts the bundle is shaped the way the store requires:
//
//   1. The .app is signed with "Apple Distribution" (not Developer ID).
//   2. The app entitlements enable App Sandbox (com.apple.security.app-sandbox).
//   3. A provisioning profile is embedded and its TeamID matches.
//   4. Every nested Mach-O is signed with team 8Y2UTZ2NBZ; spawned executables
//      (Electron helpers, login helper, ffmpeg) additionally carry
//      com.apple.security.inherit so child processes stay sandboxed. In-process
//      code (dylibs, frameworks, .node bundles) only needs the signature.
//   5. codesign --verify --deep --strict passes and the build is NOT hardened
//      (hardened runtime + MAS don't mix).
//
// Exit code is non-zero if any check fails, so it can gate CI / a release step.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, lstatSync } from "node:fs";
import { join, basename } from "node:path";

const TEAM_ID = "8Y2UTZ2NBZ";
const OUTPUT_DIR = "releases/macos";

// ---- tiny helpers -----------------------------------------------------------

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  failures++;
};
const section = (m) => console.log(`\n${m}`);

function sh(cmd, args) {
  // codesign writes its useful output to stderr; merge both streams.
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return `${r.stdout || ""}${r.stderr || ""}`;
}

// Locate the built MAS .app. The mas target writes to releases/macos/mas/ (and
// mas-dev/ for the dev variant); prefer an explicit CLI arg.
function findApp() {
  const arg = process.argv[2];
  if (arg) return arg;
  for (const sub of ["mas", "mas-universal", "mas-arm64", "mas-x64", "mas-dev"]) {
    const dir = join(OUTPUT_DIR, sub);
    if (!existsSync(dir)) continue;
    const app = readdirSync(dir).find((f) => f.endsWith(".app"));
    if (app) return join(dir, app);
  }
  return null;
}

// Walk the bundle for Mach-O files (helpers, dylibs, .node, ffmpeg). Uses
// lstat and skips symlinks so the framework's Versions/Current alias isn't
// followed back into Versions/A — otherwise every nested binary is found 3x.
function findMachO(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p, { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(p);
      } else if (st.isFile()) {
        // Cheap Mach-O sniff: file(1) is authoritative and fast enough here.
        const t = sh("file", ["-b", p]);
        if (/Mach-O/.test(t)) out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

// ---- checks -----------------------------------------------------------------

const appPath = findApp();
if (!appPath || !existsSync(appPath)) {
  console.error(
    `No MAS .app found.\nExpected one under ${OUTPUT_DIR}/mas/ — run "npm run electron:build:mas" first, or pass a path.`
  );
  process.exit(2);
}
console.log(`Verifying MAS bundle: ${appPath}`);

// 1 + 5. App signature: Apple Distribution, valid, not hardened.
section("App signature");
const appSig = sh("codesign", ["-dvvv", appPath]);
if (/Authority=Apple Distribution/.test(appSig)) pass("signed with Apple Distribution");
else fail("app is NOT signed with 'Apple Distribution' (wrong cert for MAS)");
if (new RegExp(`TeamIdentifier=${TEAM_ID}`).test(appSig)) pass(`TeamIdentifier=${TEAM_ID}`);
else fail(`app TeamIdentifier is not ${TEAM_ID}`);
if (/flags=.*runtime/.test(appSig)) fail("hardened runtime is ON (must be off for MAS)");
else pass("hardened runtime not set (correct for MAS)");

const verify = sh("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
if (/: valid on disk/.test(verify) || verify.trim() === "")
  pass("codesign --verify --deep --strict passed");
else fail(`codesign --verify failed:\n${verify.trim()}`);

// 2. App Sandbox entitlement.
section("Entitlements (App Sandbox)");
const ents = sh("codesign", ["-d", "--entitlements", ":-", appPath]);
if (/com\.apple\.security\.app-sandbox/.test(ents) && /<true\/>/.test(ents))
  pass("com.apple.security.app-sandbox enabled");
else fail("App Sandbox entitlement missing — the store will reject this");

// 3. Embedded provisioning profile.
section("Provisioning profile");
const profile = join(appPath, "Contents", "embedded.provisionprofile");
if (existsSync(profile)) {
  pass("embedded.provisionprofile present");
  // The profile is CMS-signed; security cms -D dumps the plist payload.
  const dump = sh("security", ["cms", "-D", "-i", profile]);
  if (new RegExp(TEAM_ID).test(dump)) pass(`profile references team ${TEAM_ID}`);
  else fail(`profile does not reference team ${TEAM_ID}`);
} else {
  fail("no embedded.provisionprofile in the bundle — signing did not embed it");
}

// 4. Nested Mach-O signing. Everything must be signed with the team. The
//    com.apple.security.inherit entitlement only applies to EXECUTABLES that
//    spawn as their own process (helper apps, login helper, ffmpeg) so the
//    child stays inside the parent's sandbox. Dylibs / frameworks / .node
//    bundles load in-process — the sandbox is a process attribute, so they
//    must NOT carry inherit; a valid team signature is all that's required.
section("Nested Mach-O: team signature (+ inherit on spawned executables)");
const binaries = findMachO(join(appPath, "Contents"));
const mainExe = join(appPath, "Contents", "MacOS", basename(appPath, ".app"));
let ffmpegSeen = false;
for (const bin of binaries) {
  const label = basename(bin);
  const isExecutable = /Mach-O.*executable/.test(sh("file", ["-b", bin]));
  const teamOk = new RegExp(`TeamIdentifier=${TEAM_ID}`).test(sh("codesign", ["-dvvv", bin]));
  if (/ffmpeg/i.test(label) && isExecutable) ffmpegSeen = true;

  if (!teamOk) {
    fail(`${label}: not signed with team ${TEAM_ID}`);
    continue;
  }
  // In-process code: signature is enough, inherit is N/A.
  if (!isExecutable) {
    pass(`${label}: signed (library/bundle)`);
    continue;
  }
  const ent = sh("codesign", ["-d", "--entitlements", ":-", bin]);
  // The main app executable carries app-sandbox; spawned executables carry inherit.
  if (bin === mainExe) {
    if (/com\.apple\.security\.app-sandbox/.test(ent))
      pass(`${label}: app-sandbox (main executable)`);
    else fail(`${label}: main executable missing com.apple.security.app-sandbox`);
  } else if (/com\.apple\.security\.inherit/.test(ent)) {
    pass(`${label}: team ${TEAM_ID} + inherit`);
  } else {
    fail(`${label}: spawned executable missing com.apple.security.inherit`);
  }
}
if (!ffmpegSeen) fail("ffmpeg executable not found in bundle — audio export will break");

// ---- result -----------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} problem(s) found. Fix before uploading to App Store Connect.`);
  process.exit(1);
}
console.log("All MAS sandbox checks passed. Safe to upload the .pkg via Transporter.");
