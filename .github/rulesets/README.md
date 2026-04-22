# Branch rulesets

JSON templates for [GitHub Branch Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets). GitHub doesn't auto-load these from the repo — apply once with the `gh api` commands below.

## Files

- **[`main-branch.json`](./main-branch.json)** — protect `main` against direct pushes, force-pushes, and deletion; require PR + CI to pass.

## Apply

Run once per repo (requires `gh` CLI authenticated as an admin of the repo):

```bash
cd /path/to/this/repo

# Apply main-branch ruleset
gh api \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  /repos/:owner/:repo/rulesets \
  --input .github/rulesets/main-branch.json
```

`:owner/:repo` expands from your current checkout's default remote.

## Update an existing ruleset

List current rulesets to find the ID:

```bash
gh api /repos/:owner/:repo/rulesets
```

Then update by ID:

```bash
gh api \
  -X PUT \
  /repos/:owner/:repo/rulesets/<RULESET_ID> \
  --input .github/rulesets/main-branch.json
```

## What `main-branch.json` enforces

On the default branch (`main`):

- **No direct pushes** — every change must go through a PR.
- **No force-pushes** — `git push --force` to `main` is blocked.
- **No deletion** — `main` can't be deleted by accident.
- **CI must pass** — `Lint, test, typecheck, build` job (from [`../workflows/ci.yml`](../workflows/ci.yml)) must be green before merge.
- **Squash merges only** — keeps history linear and clean.
- **Stale reviews dismissed** on new commits.
- **Unresolved review threads block merges.**
- **Admins can bypass** via the PR UI ("bypass rules to merge") — handy for emergencies but still requires a PR.

## Changing the defaults

- Raise `required_approving_review_count` from `0` → `1` once you have collaborators who can review PRs.
- Add other CI jobs to `required_status_checks` as they stabilize.
- Remove the `bypass_actors` block to enforce rules even on admins.

Edit the JSON, then re-run the `PUT` command above.
