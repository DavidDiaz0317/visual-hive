# Hive-Mediated Visual Repair Contracts

Hive owns repair orchestration and lifecycle authority. Visual Hive owns read-only visual evidence and the deterministic visual verdict. The model can request evidence and propose a patch, but neither its claimed outcome nor Hive's candidate result can override `visual-hive.repair-validation.v1`.

## Contract sequence

1. Hive selects `standard` or `visual_hive` from the requested `off`, `auto`, `on`, or `required` mode.
2. Hive creates `hive.repair-session.v1` with the repository/base identity, task and image identities, bounded source context, prompt/provider identities, budgets, validation profiles, and durable attempt/turn/request journals.
3. For `visual_hive`, Hive issues a content-addressed execution authorization. It permits exactly the eight versioned read-only Visual Hive tools and one declared validation profile.
4. The provider makes one bounded turn at a time. Hive records deterministic attempt, turn, tool-call, and validation-request IDs before continuing. Every terminal turn records the pinned provider identity, provider receipt, byte/token/cost usage, and active wall time; aggregate budgets are recomputed from those durable receipts. A subsequent turn's input envelope binds the immediately preceding provider output and exact terminal tool-outcome digest, and cannot start until that tool outcome is durable.
5. A candidate attempt records its exact patch digest, head commit, and head tree, ends in one completed `final_result` turn, and produces immutable `hive.repair-result.v1`. The result binds the exact candidate session snapshot, transcript, provider, tool receipts, diff, changed files, and validation-request specifications.
6. Each authoritative repair run context names the immutable Hive broker request ID and request digest that caused it. Visual Hive requires the before run to bind a base-role reproduction/capture request and the after run to bind the candidate-role patch-validation request, verifies neither command predates its durable journal request (and the after command does not predate the candidate result), then derives `visual-hive.repair-validation.v1` from artifact bytes and deterministic browser evidence. General `visual-hive.run-context.v1` parsing keeps this field optional so persisted pre-integration bundles remain readable; authoritative repair validation fails closed when it is absent.
7. Hive consumes the receipt and remains the only component allowed to create or update issues, branches, pull requests, merges, or closure state.

The standard path carries no Visual Hive authorization or Visual Hive tool receipts. This preserves existing Hive repair behavior and keeps control/treatment evaluation comparable.

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

Authorization binds repository fingerprint, task-context digest, base commit, validation profile, task assets, budgets, config, tool registry, and prompt schema. Visual sessions fail closed when authorization is missing, stale, widened, or used outside its time window. Actual before/after browser command timestamps must also fall inside that window. A validation request cannot introduce a command, path, URL, route, viewport, or contract outside its declared profile: reproduction binds the base commit, patch validation binds the owning attempt's recorded candidate head, and capture binds one of those explicit commit roles.

The session retains the original image-reference position as well as asset ID, role, content digest, media type, and byte size. This preserves duplicate or reordered task-image semantics while preventing an agent or adapter from silently substituting a different attachment.

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
