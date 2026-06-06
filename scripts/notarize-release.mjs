#!/usr/bin/env node
// Manual macOS notarization step for a GitHub Release.
//
// Pattern C in docs/build/releasing.md: CI ships signed-but-not-notarized
// DMGs so the build job never blocks on Apple's notary queue. This script
// is the maintainer-side companion: download each macOS DMG from the
// release, submit to Apple, wait for the verdict, staple, and re-upload.
//
// Usage:
//   node scripts/notarize-release.mjs              # uses package.json version
//   node scripts/notarize-release.mjs v1.0.4       # explicit tag
//
// Prerequisites:
//   - Keychain profile "out-loud-notary" stored via:
//       xcrun notarytool store-credentials "out-loud-notary" \
//         --apple-id "<your-apple-id>" --team-id "<TEAM_ID>"
//   - `gh` authenticated with write access to the repo
//
// The script is idempotent: if a DMG is already stapled, re-running just
// verifies and re-uploads. Safe to retry after partial failures.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "light-cloud-com/out-loud";
const KEYCHAIN_PROFILE = "out-loud-notary";

const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

function readVersionFromPkg() {
  const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  return `v${pkg.version}`;
}

function run(cmd, args, opts = {}) {
  const printable = `${cmd} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
  console.log(`\n$ ${printable}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} exited with code ${res.status}`);
  }
  return res;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a command, retrying on failure with linear backoff. Used for steps that
// can fail transiently — chiefly `stapler staple` right after notarization,
// when Apple's ticket CDN hasn't yet published the ticket that `notarytool
// submit --wait` just reported as Accepted (a few seconds of lag is common).
async function runWithRetry(cmd, args, { attempts = 5, delayMs = 15_000, label } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const printable = `${cmd} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
    console.log(`\n$ ${printable}${attempt > 1 ? `   (attempt ${attempt}/${attempts})` : ""}`);
    const res = spawnSync(cmd, args, { stdio: "inherit" });
    if (res.status === 0) return res;
    if (attempt === attempts) {
      throw new Error(`${label || cmd} failed after ${attempts} attempts (exit ${res.status})`);
    }
    console.log(`  ${label || cmd} failed (exit ${res.status}); retrying in ${delayMs / 1000}s…`);
    await sleep(delayMs);
  }
}

function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout;
}

function macDmgsForTag(tag) {
  // gh release view --json assets returns a JSON list with name + url.
  const json = runCapture("gh", ["release", "view", tag, "--repo", REPO, "--json", "assets"]);
  const { assets } = JSON.parse(json);
  return assets
    .filter((a) => a.name.toLowerCase().endsWith(".dmg"))
    .filter((a) => !a.name.endsWith(".blockmap"))
    .map((a) => a.name);
}

async function notarizeAndStaple(dmgPath) {
  console.log(`\n=== ${dmgPath} ===`);

  // Quick precheck: if already stapled, skip the slow Apple round-trip.
  const validate = spawnSync("xcrun", ["stapler", "validate", dmgPath], {
    encoding: "utf8",
  });
  if (validate.status === 0 && /worked|valid/i.test(validate.stdout)) {
    console.log("Already stapled — skipping notarytool submit.");
    return;
  }

  // Submit + block until Apple returns Accepted / Invalid. Apple's normal
  // SLA is 5-15 min; can be longer when the notary service is congested.
  run("xcrun", [
    "notarytool",
    "submit",
    dmgPath,
    "--keychain-profile",
    KEYCHAIN_PROFILE,
    "--wait",
    "--timeout",
    "2h",
  ]);

  // Embed the ticket in the DMG so Gatekeeper trusts it offline. Retry: the
  // ticket can take a few seconds to propagate to Apple's CDN after `submit
  // --wait` returns Accepted, so a bare `staple` here can spuriously fail.
  await runWithRetry("xcrun", ["stapler", "staple", dmgPath], { label: "stapler staple" });

  // Verify the ticket is actually embedded. `stapler validate` is the
  // authoritative check for a stapled DMG — DO NOT use `spctl --assess` on the
  // unmounted .dmg here: a disk image has no code signature of its own, so
  // spctl reports "no usable signature" even when the ticket is correctly
  // stapled. The real Gatekeeper assessment applies to the .app inside, which
  // we check below after mounting.
  run("xcrun", ["stapler", "validate", dmgPath]);
}

// Mount the stapled DMG and assess the .app the way Gatekeeper actually will,
// confirming the end-user "open downloaded app" experience is clean.
function assessAppInside(dmgPath) {
  const attach = spawnSync(
    "hdiutil",
    ["attach", dmgPath, "-nobrowse", "-noverify", "-noautoopen"],
    { encoding: "utf8" }
  );
  const mount = (attach.stdout || "")
    .split("\n")
    .map((l) => l.match(/(\/Volumes\/.+)$/)?.[1])
    .filter(Boolean)
    .pop();
  if (!mount) {
    console.log(`  (could not mount ${dmgPath} for app assessment — skipping)`);
    return;
  }
  try {
    const apps = spawnSync("sh", ["-c", `ls -d "${mount}"/*.app`], { encoding: "utf8" });
    const app = (apps.stdout || "").trim().split("\n")[0];
    if (app) {
      run("spctl", ["-a", "-vvv", "-t", "exec", app]);
    }
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-quiet"]);
  }
}

async function main() {
  const tag = process.argv[2] || readVersionFromPkg();
  if (!/^v\d+\.\d+\.\d+/.test(tag)) {
    throw new Error(`Tag "${tag}" doesn't look like vX.Y.Z`);
  }

  console.log(`Notarizing macOS artifacts for ${tag} (repo: ${REPO})`);

  const dmgs = macDmgsForTag(tag);
  if (dmgs.length === 0) {
    throw new Error(`No .dmg assets found on release ${tag}.`);
  }
  console.log(`Found ${dmgs.length} DMG(s) on the release: ${dmgs.join(", ")}`);

  const workDir = mkdtempSync(join(tmpdir(), "out-loud-notarize-"));
  console.log(`Working directory: ${workDir}`);

  try {
    // Download all DMGs in one call.
    const patterns = dmgs.flatMap((d) => ["--pattern", d]);
    run("gh", ["release", "download", tag, "--repo", REPO, "--dir", workDir, ...patterns]);

    // Process each DMG independently — a failure on one (e.g. Apple rejects a
    // single arch) must not prevent the others from being notarized.
    const succeeded = [];
    const failed = [];
    for (const name of dmgs) {
      const path = join(workDir, name);
      try {
        if (!existsSync(path)) {
          throw new Error(`Expected file ${path} after gh download, but it's missing.`);
        }
        await notarizeAndStaple(path);
        assessAppInside(path);
        succeeded.push(name);
      } catch (err) {
        console.error(`\n[notarize-release] ${name} FAILED: ${err.message}`);
        failed.push(name);
      }
    }

    // Re-upload only the DMGs we actually stapled (--clobber overwrites the
    // unstapled versions that CI uploaded). Never push a half-processed DMG.
    if (succeeded.length > 0) {
      const uploadPaths = succeeded.map((d) => join(workDir, d));
      run("gh", ["release", "upload", tag, "--repo", REPO, "--clobber", ...uploadPaths]);
    }

    console.log(`\n--- Summary -------------------------------------------------`);
    console.log(
      `Notarized + stapled + re-uploaded (${succeeded.length}): ${succeeded.join(", ") || "none"}`
    );
    if (failed.length > 0) {
      console.log(`Failed (${failed.length}): ${failed.join(", ")}`);
      throw new Error(`${failed.length} of ${dmgs.length} DMG(s) failed to notarize.`);
    }

    console.log(`\nAll ${dmgs.length} DMG(s) notarized, stapled, and re-uploaded.`);
    console.log(
      `Next: install the stapled DMG; double-clicking the app should now open with no Gatekeeper dialog.`
    );
    console.log(
      `      Then publish the release:  gh release edit ${tag} --repo ${REPO} --draft=false`
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\n[notarize-release] FAILED:", err.message);
  process.exit(1);
});
