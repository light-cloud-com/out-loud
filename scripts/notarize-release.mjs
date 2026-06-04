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

function notarizeAndStaple(dmgPath) {
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

  // Embed the ticket in the DMG so Gatekeeper trusts it offline.
  run("xcrun", ["stapler", "staple", dmgPath]);

  // Quick sanity check the staple worked. A DMG is a disk image, not a .pkg
  // installer, so `--type install` reports "no usable signature". Gatekeeper
  // evaluates a notarized DMG under the "open downloaded file" policy, so
  // assess it with `--type open` against the stapled notarization ticket.
  run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose",
    dmgPath,
  ]);
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

    for (const name of dmgs) {
      const path = join(workDir, name);
      if (!existsSync(path)) {
        throw new Error(`Expected file ${path} after gh download, but it's missing.`);
      }
      notarizeAndStaple(path);
    }

    // Upload all stapled DMGs in one call (--clobber overwrites the
    // unstapled versions that CI uploaded).
    const uploadPaths = dmgs.map((d) => join(workDir, d));
    run("gh", ["release", "upload", tag, "--repo", REPO, "--clobber", ...uploadPaths]);

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
