#!/usr/bin/env node
// One-command release for Out Loud.
//
//   node scripts/release.mjs 1.0.8        # explicit version
//   node scripts/release.mjs patch        # or minor / major
//   npm run release 1.0.8
//
// What it does, start to finish — no other manual steps:
//   1. Preflight: gh authed, on a clean `main` that matches origin.
//   2. Bump version on a release branch, open a PR, wait for CI, squash-merge.
//   3. Tag the merged commit and push → triggers the Release build workflow.
//   4. Wait for the macOS/Windows/Linux builds + draft release to finish.
//   5. Publish the release (un-draft).
//   6. Notarize the macOS DMGs (scripts/notarize-release.mjs) — the LAST step,
//      strictly after the builds are done and the release is published.
//
// Prerequisites (one-time):
//   - `gh` authenticated with write access to the repo.
//   - macOS notary keychain profile "out-loud-notary" (see notarize-release.mjs).
//   - The tag ruleset must ALLOW tag creation by you. If you hit
//     "Cannot create ref due to creations being restricted" at the tag step,
//     remove the "Restrict creations" rule on refs/tags/** (or add yourself as
//     a bypass actor) in the repo/org ruleset settings.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "light-cloud-com/out-loud";
const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: projectRoot, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} exited with code ${res.status}`);
  return res;
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: projectRoot, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || ""}`);
  return res.stdout.trim();
}

function tryCapture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: projectRoot, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function sleep(seconds) {
  spawnSync("sleep", [String(seconds)], { stdio: "ignore" });
}

function currentVersion() {
  return JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
}

// Resolve "1.2.3" | "patch" | "minor" | "major" → "1.2.3"
function resolveVersion(arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [maj, min, pat] = currentVersion().split(".").map(Number);
  if (arg === "major") return `${maj + 1}.0.0`;
  if (arg === "minor") return `${maj}.${min + 1}.0`;
  if (arg === "patch") return `${maj}.${min}.${pat + 1}`;
  fail(`Invalid version "${arg}" — use a semver like 1.0.8, or patch/minor/major.`);
}

// ---- main -------------------------------------------------------------------

const arg = process.argv[2];
if (!arg) fail("Usage: node scripts/release.mjs <version|patch|minor|major>");

const version = resolveVersion(arg);
const tag = `v${version}`;
const branch = `release-${tag}`;

console.log(`\n=== Releasing ${tag} (current: ${currentVersion()}) ===`);

// 1. Preflight ----------------------------------------------------------------
if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
  fail("GitHub CLI not authenticated. Run: gh auth login");
}
const onBranch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (onBranch !== "main") fail(`Switch to main first (on "${onBranch}").`);
if (capture("git", ["status", "--porcelain"]))
  fail("Working tree is not clean — commit or stash first.");
if (
  tryCapture("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]) ||
  capture("git", ["ls-remote", "--tags", "origin", tag])
) {
  fail(
    `Tag ${tag} already exists (locally or on origin). Delete it first, or pick another version.`
  );
}
run("git", ["fetch", "origin", "main", "--quiet"]);
if (capture("git", ["rev-parse", "main"]) !== capture("git", ["rev-parse", "origin/main"])) {
  fail("Local main differs from origin/main. Run: git pull --ff-only");
}

// 2. Bump → PR → CI → merge ---------------------------------------------------
run("git", ["checkout", "-b", branch]);
run("npm", ["version", version, "--no-git-tag-version"]);
run("git", ["commit", "-am", `release: ${version}`]);
run("git", ["push", "-u", "origin", branch]);

run("gh", [
  "pr",
  "create",
  "--repo",
  REPO,
  "--base",
  "main",
  "--head",
  branch,
  "--title",
  `release: ${version}`,
  "--body",
  `Release ${tag}.`,
]);

console.log("\n⏳ Waiting for CI checks to pass…");
run("gh", ["pr", "checks", branch, "--repo", REPO, "--watch", "--fail-fast"]);
run("gh", ["pr", "merge", branch, "--repo", REPO, "--squash", "--delete-branch"]);

// 3. Tag the merged commit → triggers the Release build workflow --------------
run("git", ["checkout", "main"]);
run("git", ["pull", "--ff-only", "origin", "main"]);
run("git", ["tag", tag]);
console.log("\nPushing tag (needs tag-creation to be allowed by repo rules)…");
const push = spawnSync("git", ["push", "origin", tag], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: ["inherit", "inherit", "pipe"],
});
if (push.status !== 0) {
  process.stderr.write(push.stderr || "");
  if (/creations being restricted|rule violations/i.test(push.stderr || "")) {
    fail(
      `Tag push blocked by a repository ruleset. Remove the "Restrict creations" rule on\n` +
        `  refs/tags/** (or add yourself as a bypass actor) in the repo/org ruleset settings,\n` +
        `  then finish the release manually (in order):\n` +
        `    git push origin ${tag}\n` +
        `    gh run watch                                   # wait for the build\n` +
        `    gh release edit ${tag} --repo ${REPO} --draft=false   # publish\n` +
        `    node scripts/notarize-release.mjs ${tag}       # notarize (last)`
    );
  }
  fail("git push of the tag failed.");
}

// 4. Wait for the Release workflow run for this tag ---------------------------
console.log("\n⏳ Waiting for the Release build to start…");
let runId = null;
for (let i = 0; i < 20 && !runId; i++) {
  sleep(6);
  const json = tryCapture("gh", [
    "run",
    "list",
    "--repo",
    REPO,
    "--workflow",
    "Release",
    "--branch",
    tag,
    "--json",
    "databaseId,status",
    "--limit",
    "1",
  ]);
  if (json) {
    const runs = JSON.parse(json);
    if (runs.length) runId = runs[0].databaseId;
  }
}
if (!runId)
  fail(
    `Couldn't find the Release run for ${tag}. Check the Actions tab, then notarize + publish manually.`
  );
console.log(`\n⏳ Building (run ${runId}) — this is the slow part (~8–10 min)…`);
run("gh", ["run", "watch", String(runId), "--repo", REPO, "--exit-status"]);

// 5. Publish (un-draft) — only now that the builds are done and assets exist --
run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false"]);

// 6. Notarize the macOS DMGs — the LAST step, after publish -------------------
// notarize-release.mjs re-uploads the stapled DMGs in place (gh ... --clobber),
// so it works fine against an already-published release.
run("node", [join(projectRoot, "scripts", "notarize-release.mjs"), tag]);

console.log(`\n✅ Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
