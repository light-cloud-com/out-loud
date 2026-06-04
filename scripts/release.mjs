#!/usr/bin/env node
// One-command release for Out Loud.
//
//   node scripts/release.mjs 1.0.8        # explicit version
//   node scripts/release.mjs patch        # or minor / major
//   npm run release 1.0.8
//
// Runs the whole pipeline, and is RESUMABLE — if it stops partway (CI, network,
// a build hiccup), just run the same command again and it picks up where it
// left off (it detects the existing branch / PR / tag / release and skips the
// steps already done):
//   1. Preflight (fresh start only): gh authed, clean `main` matching origin.
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
//   - Use a NEW version each time. "Immutable releases" permanently reserves a
//     tag once it's been used, so a previously-released (even deleted) version
//     can't be reused — always bump forward.

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

// Returns trimmed stdout, or null if the command failed (non-fatal probe).
function tryCapture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: projectRoot, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function ghJson(args) {
  const out = tryCapture("gh", args);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
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

// Wait for the PR's CI to pass. Robust against the gap right after a PR is
// created, when `gh pr checks --watch` errors with "no checks reported" instead
// of waiting — we just retry until the checks register, then it blocks to the end.
function waitForChecks(branch) {
  console.log("\n⏳ Waiting for CI checks (retries until they register)…");
  for (let i = 0; i < 120; i++) {
    const res = spawnSync(
      "gh",
      ["pr", "checks", branch, "--repo", REPO, "--watch", "--fail-fast"],
      {
        cwd: projectRoot,
        encoding: "utf8",
      }
    );
    const text = (res.stdout || "") + (res.stderr || "");
    if (res.status === 0) {
      process.stdout.write(res.stdout || "");
      return;
    }
    if (/no checks reported/i.test(text)) {
      sleep(8);
      continue;
    }
    process.stdout.write(res.stdout || "");
    process.stderr.write(res.stderr || "");
    fail("CI checks did not pass — fix them, push to the branch, and re-run.");
  }
  fail("Timed out waiting for CI checks to register.");
}

function pushTag(tag) {
  console.log(`\nPushing tag ${tag}…`);
  const res = spawnSync("git", ["push", "origin", tag], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["inherit", "inherit", "pipe"],
  });
  if (res.status === 0) return;
  process.stderr.write(res.stderr || "");
  if (/immutable|creations being restricted|rule violations/i.test(res.stderr || "")) {
    fail(
      `Tag ${tag} can't be created. If this exact version was released (even if later deleted),\n` +
        `  "Immutable releases" reserves it permanently — bump to a new version. Otherwise a tag\n` +
        `  ruleset has "Restrict creations" enabled; relax it (or add an "Always" bypass).`
    );
  }
  fail("git push of the tag failed.");
}

// ---- main -------------------------------------------------------------------

const arg = process.argv[2];
if (!arg) fail("Usage: node scripts/release.mjs <version|patch|minor|major>");

const version = resolveVersion(arg);
const tag = `v${version}`;
const branch = `release-${tag}`;

console.log(`\n=== Releasing ${tag} (current: ${currentVersion()}) ===`);

if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) {
  fail("GitHub CLI not authenticated. Run: gh auth login");
}

// Detect what already exists, so a re-run resumes instead of starting over.
const tagOnRemote = !!tryCapture("git", ["ls-remote", "--tags", "origin", tag]);
const release = ghJson(["release", "view", tag, "--repo", REPO, "--json", "isDraft,assets"]);
const prInfo = ghJson(["pr", "view", branch, "--repo", REPO, "--json", "state"]);
const prState = prInfo ? prInfo.state : null; // OPEN | MERGED | CLOSED | null

// ---- Stage A: get the version bump merged into main -------------------------
const bumpMerged = tagOnRemote || release !== null || prState === "MERGED";

if (bumpMerged) {
  console.log("• Version bump already merged — resuming at the tag/build stage.");
} else {
  const branchPushed = !!tryCapture("git", ["ls-remote", "--heads", "origin", branch]);

  if (!branchPushed) {
    // Fresh start — require a clean main that matches origin.
    const onBranch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (onBranch !== "main") fail(`Switch to main first (on "${onBranch}").`);
    if (capture("git", ["status", "--porcelain"]))
      fail("Working tree is not clean — commit or stash first.");
    run("git", ["fetch", "origin", "main", "--quiet"]);
    if (capture("git", ["rev-parse", "main"]) !== capture("git", ["rev-parse", "origin/main"]))
      fail("Local main differs from origin/main. Run: git pull --ff-only");

    run("git", ["checkout", "-b", branch]);
    run("npm", ["version", version, "--no-git-tag-version"]);
    run("git", ["commit", "-am", `release: ${version}`]);
    run("git", ["push", "-u", "origin", branch]);
  } else {
    console.log("• Release branch already pushed — resuming (skipping the version bump).");
  }

  if (prState !== "OPEN") {
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
  } else {
    console.log(`• PR for ${branch} already open — reusing it.`);
  }

  waitForChecks(branch);
  // --admin uses the maintainer's admin bypass to merge once CI is green. The
  // main ruleset grants admins a pull_request bypass, but a plain merge is
  // still "prohibited by base branch policy"; --admin is the intended path.
  run("gh", ["pr", "merge", branch, "--repo", REPO, "--squash", "--delete-branch", "--admin"]);
}

// ---- Stage B: tag the merged commit → triggers the build --------------------
run("git", ["checkout", "main"]);
run("git", ["pull", "--ff-only", "origin", "main"]);
if (!tagOnRemote) {
  if (!tryCapture("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])) {
    run("git", ["tag", tag]);
  }
  pushTag(tag);
} else {
  console.log(`• Tag ${tag} already on origin — skipping tag push.`);
}

// ---- Stage C: wait for the Release build (skip if assets already present) ---
const built = ghJson(["release", "view", tag, "--repo", REPO, "--json", "assets"]);
if (!built || (built.assets || []).length === 0) {
  console.log("\n⏳ Waiting for the Release build to start…");
  let runId = null;
  for (let i = 0; i < 20 && !runId; i++) {
    sleep(6);
    const runs = ghJson([
      "run",
      "list",
      "--repo",
      REPO,
      "--workflow",
      "Release",
      "--branch",
      tag,
      "--json",
      "databaseId",
      "--limit",
      "1",
    ]);
    if (runs && runs.length) runId = runs[0].databaseId;
  }
  if (!runId)
    fail(
      `Couldn't find the Release run for ${tag}. Check the Actions tab, then re-run this script.`
    );
  console.log(`\n⏳ Building (run ${runId}) — the slow part (~8–10 min)…`);
  run("gh", ["run", "watch", String(runId), "--repo", REPO, "--exit-status"]);
} else {
  console.log(`• Build artifacts already attached to ${tag} — skipping the build wait.`);
}

// ---- Stage D: publish (un-draft) — idempotent -------------------------------
run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false"]);

// ---- Stage E: notarize the macOS DMGs — the LAST step -----------------------
// notarize-release.mjs is idempotent (skips already-stapled DMGs) and re-uploads
// in place via gh ... --clobber, so it's safe on an already-published release.
run("node", [join(projectRoot, "scripts", "notarize-release.mjs"), tag]);

console.log(`\n✅ Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
