# Isolated proof harness

`npm run proof:harness -- ...` runs the fork-only AI-HPC evidence lane without publishing, opening a pull request, merging, or updating a screenshot baseline. It is deliberately narrower than release tooling and Hive setup: its only job is to produce reviewable evidence from exact local commits.

The harness refuses to pull an image. The reviewed Playwright image must already exist locally at this repository digest:

```text
mcr.microsoft.com/playwright@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948
```

It also requires caller-supplied commit, tree, and lockfile SHA-256 identities for both clean worktrees. It rejects dirty worktrees, linked/reparse tracked files, digest drift, an existing output directory, or an output below either source worktree.

## Preliminary proof

```powershell
npm run proof:harness -- `
  --mode preliminary `
  --target-root C:\path\to\ai-hpc-fork `
  --target-commit <40-character-sha> `
  --target-tree <40-character-tree-sha> `
  --target-lock-sha256 <dashboard-package-lock-sha256> `
  --visual-hive-commit <40-character-sha> `
  --visual-hive-tree <40-character-tree-sha> `
  --visual-hive-lock-sha256 <package-lock-sha256> `
  --output C:\path\to\new-proof-output
```

The harness creates local Git bundles, clones them into a disposable container, and installs/builds both repositories while the container is networked. The Visual Hive build and root-owned attestations are then made unavailable for target writes; the target clone, target commands, and CLI execution all run as the image's unprivileged `pwuser`. The container uses private IPC with a fixed 2 GiB shared-memory allocation, drops every Linux capability, enables `no-new-privileges`, publishes no ports, and receives only the read-only bundle mount. It binds the exact built CLI, config loader, package dist digest, Playwright package, Chromium executable, OS, Node runtime, reviewed config, and non-root execution identity, and rechecks those identities after execution. It runs the target source preflight exactly once, disconnects every Docker network, proves both Docker control-plane isolation and failed active egress, and only then invokes:

```text
visual-hive pipeline --config visual-hive.config.yaml --mode pr --ci --enforce-mutation --skip-install --skip-build
```

The complete plan must be exactly `app-shell-content-health`. The result is accepted only when the deterministic report, `api-500` mutation, pipeline, runtime sidecar, font inventory, baseline set, and selected Hive/test-creation evidence are complete and mutually bound.

Before export, the harness terminates and proves the absence of remaining `pwuser` processes. Asserted report, runtime, plan, mutation, pipeline, and PNG bytes are frozen into exclusive root-owned files, then the mode-specific assertions are rerun against those frozen copies. Only a fixed allowlist of evidence files is exported. Command output is never copied, file identities are uniquely sorted in the manifest, and source/export races, secret-shaped content, or a sensitive environment value invalidate the export.

## Candidate evidence

Use a different, new output directory and `--mode candidate`. This is a separate expected-red transaction. Its plan must be exactly `app-shell-visual-stability`; a passing comparison is rejected. The export contains only attestations, the candidate plan/report/runtime sidecar, candidate PNGs, and diff PNGs. It never copies, approves, or overwrites a baseline. The manifest always records `approvalStatus: not_approved`.

Both modes create containers with no published host ports. Cleanup removes only the uniquely named container/network created by that invocation. Any cleanup failure invalidates an otherwise successful run.

## Bound runtime sidecar

The harness uses the normal Visual Hive CLI with `--runtime-sidecar <path>`. This is a narrow pass-through to the existing Playwright execution-binding implementation. Omitting it preserves the prior `run` and `pipeline` behavior; supplying it exclusively creates a new `.visual-hive/proof/**/runtime.json` browser/runtime/font sidecar and binds it to the same generated spec/config and report execution digest. Existing destinations and paths outside that dedicated subtree are refused.

Run the fake-runner and fail-closed orchestration tests without Docker:

```bash
npm run test:proof-harness
```
