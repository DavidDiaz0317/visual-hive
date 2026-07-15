# Hive-Mediated Visual Repair Contracts

Hive owns repair orchestration and lifecycle authority. Visual Hive owns read-only visual evidence and the deterministic visual verdict. The model can request evidence and propose a patch, but neither its claimed outcome nor Hive's candidate result can override `visual-hive.repair-validation.v1`.

## Contract sequence

1. Hive selects `standard` or `visual_hive` from the requested `off`, `auto`, `on`, or `required` mode.
2. Hive creates `hive.repair-session.v1` with the repository/base identity, task and image identities, bounded source context, prompt/provider identities, budgets, validation profiles, and durable attempt/turn/request journals.
3. For `visual_hive`, Hive issues a content-addressed execution authorization. It permits exactly the eight versioned read-only Visual Hive tools and one declared validation profile. The authorization and capability pin the verified Visual Hive release-manifest SHA-256 and executing entrypoint SHA-256 in addition to version and commit.
4. The provider makes one bounded turn at a time. Hive records deterministic attempt, turn, tool-call, and validation-request IDs before continuing. Every terminal turn records the pinned provider identity, provider receipt, byte/token/cost usage, and active wall time; aggregate budgets are recomputed from those durable receipts. A subsequent turn's input envelope binds the immediately preceding provider output and exact terminal tool-outcome digest, and cannot start until that tool outcome is durable.
5. A candidate attempt records its exact patch digest, head commit, and head tree, ends in one completed `final_result` turn, and produces immutable `hive.repair-result.v1`. The result binds the exact candidate session snapshot, transcript, provider, tool receipts, diff, changed files, and validation-request specifications.
6. Each authoritative repair run context names the immutable Hive broker request ID and request digest that caused it. Visual Hive requires the before run to bind a base-role reproduction/capture request and the after run to bind the candidate-role patch-validation request, verifies neither command predates its durable journal request (and the after command does not predate the candidate result), then derives `visual-hive.repair-validation.v1` from artifact bytes and deterministic browser evidence. General `visual-hive.run-context.v1` parsing keeps this field optional so persisted pre-integration bundles remain readable; authoritative repair validation fails closed when it is absent.
7. Hive consumes the receipt and remains the only component allowed to create or update issues, branches, pull requests, merges, or closure state.

The standard path carries no Visual Hive authorization or Visual Hive tool receipts. This preserves existing Hive repair behavior and keeps control/treatment evaluation comparable.

## Capability mode matrix

| Requested mode | Verified Visual Hive unavailable | Verified Visual Hive available | Effective mode | Tool and verdict behavior |
| --- | --- | --- | --- | --- |
| `off` | Continue | Continue | `standard` | Visual Hive authorization, repair tools, and tool receipts are forbidden. Original task images may still be supplied directly to the provider. |
| `auto` | Continue in standard mode | Select Visual Hive only when task images, browser/UI evidence, visual contracts, or a likely frontend surface provide a recorded selection reason | `standard` or `visual_hive` | The durable session records why Visual Hive was or was not selected. No silent first-issue or first-profile selection is allowed. |
| `on` | Block before a model turn | Continue | `visual_hive` | The eight scoped tools are available, but actual calls remain model-directed and budgeted. A candidate cannot be published as visually successful without comparable deterministic validation. |
| `required` | Block before a model turn | Continue | `visual_hive` | Version 1 preserves the stronger caller policy intent and permits no standard fallback. It has the same fail-closed authorization and receipt boundary as `on`; later versions may add stricter requirements only through a versioned contract change. |

The version 1 contract deliberately maps both `on` and `required` only to `visual_hive`. Treating either as an implicit standard-mode fallback would violate the signed session. `auto` is the only requested mode that can legitimately resolve to either effective mode.

## Immutable candidate snapshot

The repair result binds a pre-validation session snapshot in state `candidate` or `awaiting_validation`. Base reproduction/capture and candidate patch-validation request specifications are immutable in the result and are also embedded by identity in their resulting run contexts. Mutable request state and receipt digests remain in Hive's session journal.

This separation prevents a digest cycle:

- result digest -> Visual Hive validation receipt;
- validation receipt -> later Hive journal event;
- later journal state does not rewrite the result that the receipt verified.

Hive must retain the exact bound candidate snapshot even after its live session advances. PR, merge, post-merge, and issue-closure facts are separate lifecycle records rather than fields that mutate the candidate result.

## Identity and authorization

All digests use canonical JSON and SHA-256. The contracts define deterministic projections for:

- session ID: repository, recurrence, task issue identity, problem statement, and base commit;
- attempt ID: session, ordinal, and prompt digest;
- turn ID: session, attempt, ordinal, and model-input digest;
- tool-call ID: session, turn, sequence, tool name, and argument digest;
- validation request ID/idempotency key: session, attempt, kind, profile, commit, and authorization.

Authorization binds repository fingerprint, task-context digest, base commit, validation profile, task assets, budgets, config, tool registry, prompt schema, release-manifest digest, and entrypoint digest. Visual sessions fail closed when authorization is missing, stale, widened, substituted, or used outside its time window. Actual before/after browser command timestamps and final publication must also fall inside that window. A validation request cannot introduce a command, path, URL, route, viewport, or contract outside its declared profile: reproduction binds the base commit, patch validation binds the owning attempt's recorded candidate head, and capture binds one of those explicit commit roles.

The session retains the original image-reference position as well as asset ID, role, content digest, media type, and byte size. This preserves duplicate or reordered task-image semantics while preventing an agent or adapter from silently substituting a different attachment.

## Verified producer identity

Authoritative repair capture runs only from an immutable packaged Visual Hive release. At process start, Visual Hive verifies `visual-hive.release.v1` from `release-manifest.json` beside the executing entrypoint. Verification requires:

- a canonical ordinary release directory and ordinary bounded files, not symlinks or alternate paths;
- strict manifest schema, `name: visual-hive`, a 40-character commit, `node: ">=22"`, and a manifest version matching the executing CLI;
- one safe, unique inventory entry for the executing entrypoint;
- exact entrypoint byte size and SHA-256 agreement with the inventory;
- bounded inventory count and aggregate bytes.

The verifier returns `visualHiveVersion`, `visualHiveCommit`, `manifestSha256`, and `entrypointSha256`. Hive must bind all four values into the session capability and execution authorization. Capture rejects a producer whose verified identity differs from that binding. A source checkout, globally resolved package, version string alone, or commit string alone is not authoritative producer identity.

## Exact CLI flow

These commands are the concrete Visual Hive side of a Hive-brokered session. Hive creates the JSON inputs and records every returned path and digest; users and models do not hand-author or edit them. The examples assume `visual-hive` resolves to the verified packaged release.

First ingest the exact task context and original image bytes into an existing canonical store directory:

```bash
visual-hive repair ingest-task \
  --store <absolute-repair-store> \
  --input <visual-hive.task-context.v1-input.json> \
  --asset-root <absolute-task-asset-root>
```

Use the returned `taskContextPath` in the remaining commands. Inspect or start the session-scoped repair MCP server:

```bash
visual-hive repair mcp \
  --store <absolute-repair-store> \
  --hive-session <hive.repair-session.v1.json> \
  --describe

visual-hive repair mcp \
  --store <absolute-repair-store> \
  --hive-session <hive.repair-session.v1.json> \
  --stdio
```

Capture the clean base commit using the base-role request already present in the immutable session:

```bash
visual-hive repair capture \
  --cwd <absolute-clean-base-worktree> \
  --config visual-hive.config.yaml \
  --task-context <taskContextPath> \
  --hive-session <candidate-session.json> \
  --request <base-reproduction-or-capture-request.json> \
  --authorization <execution-authorization.json> \
  --budget <repair-budget-limits.json> \
  --finding <canonical-finding.json> \
  --phase before \
  --source-ref refs/heads/main \
  --source-event hive_repair \
  --source-trusted
```

Capture the exact clean candidate commit using its candidate-role patch-validation request:

```bash
visual-hive repair capture \
  --cwd <absolute-clean-candidate-worktree> \
  --config visual-hive.config.yaml \
  --task-context <taskContextPath> \
  --hive-session <candidate-session.json> \
  --request <candidate-patch-validation-request.json> \
  --authorization <execution-authorization.json> \
  --budget <repair-budget-limits.json> \
  --finding <canonical-finding.json> \
  --phase after \
  --source-ref refs/heads/hive/repair-<id> \
  --source-event hive_repair \
  --source-trusted
```

Finally derive the deterministic receipt. Substitute each capture command's returned `bundleDirectory` and `runContextPath` exactly; `runContextPath` is the source path inventoried inside that bundle:

```bash
visual-hive repair validate \
  --store <absolute-repair-store> \
  --task-context <taskContextPath> \
  --hive-session <candidate-session.json> \
  --hive-result <hive.repair-result.v1.json> \
  --before-bundle <before.bundleDirectory> \
  --before-run-context <before.runContextPath> \
  --after-bundle <after.bundleDirectory> \
  --after-run-context <after.runContextPath> \
  --validation-id <stable-validation-id>
```

The capture commands are idempotent only for the same exact request and immutable inputs. A conflicting reuse, dirty worktree, wrong `HEAD`, stale authorization, altered producer, or mismatched task/session/request fails closed. The validate command writes one immutable receipt in the computed session namespace and rejects conflicting reuse.

## Schemas and maintenance

Runtime schemas and builders live in `packages/core/src/repair/hiveContracts.ts`.

Checked-in JSON Schemas:

- `schemas/visual-hive.hive-repair-session.schema.json`
- `schemas/visual-hive.hive-repair-result.schema.json`

Regenerate them after an intentional contract change:

```bash
node scripts/generate-hive-repair-contract-schemas.mjs
```

Any contract change must update the Zod schema, generated JSON Schema, cross-language vectors, Hive Go implementation, tests, and this document together. Existing `v1` fields and digest projections are immutable; incompatible changes require a new schema version.

## Deterministic validation boundary

`buildVisualRepairValidationFromArtifacts` requires all six identity-bearing inputs:

- verified Visual Hive task context;
- exact Hive candidate session snapshot;
- exact Hive repair result;
- before bundle/run context/payloads;
- after bundle/run context/payloads;
- validation time and ID.

It verifies result-to-session equality for provider, attempts, tool receipts, validation requests, repository, task, finding, authorization, and transcript before reading browser evidence. It rejects stale commits, cross-repository artifacts, non-authoritative scans, incomplete regression inventory, policy weakening, missing baselines, capture failure, and non-comparable run identities. Only the derived deterministic receipt can recommend visual resolution.

## Comparator identity

Repair image comparison uses the fixed identity `pixelmatch.v7.threshold-0.1.include-aa-false.diagnostic-v2`. It means Pixelmatch major version 7, comparator sensitivity `0.1`, antialiased pixels excluded from the mismatch count, and a transparent diagnostic mask with fixed colors: orange (`#ffa500`) for changed overlap pixels, magenta (`#ff0080`) for removed-only pixels, and cyan (`#00c0ff`) for added-only pixels. The current lock resolves Pixelmatch `7.2.0` and PNGJS `7.0.0`; the verified release entrypoint digest binds the exact bundled implementation.

Every comparison result carries that algorithm identity, the explicit before and after dimensions, comparison-canvas dimensions, deterministic changed bounding box (or `null`), mismatch-pixel count, total-pixel count, ratio, and diff-image digest. An unequal-dimension comparison remains fail-closed with the full comparison canvas counted as changed, preserving verdict math, while the mask and bounding box localize the pixels that changed or exist on only one side. MCP callers cannot supply a comparator threshold. The comparator's `0.1` sensitivity is distinct from a contract's allowed `maxDiffPixelRatio` or `maxDiffPixels`: contract policy decides pass/fail only after the fixed comparator computes evidence. Before and after validation rejects missing, substituted, or differently identified comparison evidence rather than silently recomputing with another algorithm.

## Playwright execution integrity

Repository install, build, setup, and serve commands are treated as untrusted. The repair runner starts lifecycle work first, then exclusively creates a collision-resistant execution namespace and generates the exact spec and config to be executed. Expected hashes come from the trusted in-memory generator output and are compared with disk before launch and after process exit.

For an authoritative Hive-integrated run, these adapter checks are one layer of the boundary, not the operating-system sandbox. Hive must launch the repository lifecycle and browser execution through its broker with all three properties below, and must block publication when the selected platform cannot provide them:

- the repository process cannot read or replace the Hive-owned execution namespace, generated verifier, authorization material, or browser result directory;
- the child receives an allowlisted environment and cannot inspect the broker or sibling-process environment;
- the complete process tree is terminated as one kernel-owned unit (a kill-on-close Job Object on Windows, or an equivalent container/cgroup boundary on Linux), including descendants that detach from their original process group.

The broker may expose only the declared target endpoint and bounded input mounts. Merely running repository code under the same user with a random directory name or best-effort parent-process cleanup is not authoritative isolation. Standalone runs without this broker sandbox remain useful local evidence, but Hive must not use them to publish a repair, merge a PR, or close a finding.

Visual Hive always invokes its packaged Playwright CLI and embeds packaged Playwright, Pixelmatch, and PNG decoder entrypoints in the generated verifier. A target repository's `node_modules` cannot replace the verifier. Each browser process receives a fresh 256-bit nonce only through its environment. An HMAC binds the capture input, broker request, phase, commit, generated inputs, expected contract/target/result inventory, and output paths. The raw nonce is never persisted. Runtime and structured-result records must carry the exact persisted binding.

Passing requires agreement between the real process exit, exact Playwright reporter inventory, strict bound result inventory, nested deterministic assertions, and complete artifacts. Missing, extra, duplicate, oversized, wrongly targeted, unbound, or malformed results fail closed. Cleanup, runtime-identity, authorization-expiry, or generated-input integrity failures cannot become an authoritative pass.

Execution paths are repository-relative, checked for containment and linked ancestors after lifecycle startup, and created exclusively. Failed attempts retain a durable intent that names their random execution directory and bounded lease; retry removes that associated directory before archiving the failed attempt. PID liveness alone never creates an unbounded lease.

`visual-hive repair validate` returns a compact result containing the receipt digest plus the exact session ID/digest, authorization digest, task-context digest, and Hive repair-result digest. Hive must verify those bindings and the candidate head before using the receipt as a publication or merge gate. Issue closure still requires a separate fresh target-branch run after merge.
