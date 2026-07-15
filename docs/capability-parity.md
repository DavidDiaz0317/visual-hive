# Capability parity

`visual-hive capabilities` compares the installed product surface with a reviewed, frozen baseline and writes `.visual-hive/capability-parity.json`.

The receipt covers every canonical CLI command and alias, JSON Schema, evidence resource and read tool, non-MCP artifact surface, plan mode, workflow lane, deterministic mutation operator, selector assertion and flow action, provider, managed open-source adapter, and Control Plane HTTP surface. CLI entries include a SHA-256 digest of their complete positional-argument and option contract, including required/optional/variadic flags, defaults, choices, environment bindings, and parsers. Schema entries include a digest of the complete canonical JSON body, not only the filename and `$id`. This means an unchanged command path or schema identity cannot conceal removed behavior.

Workflow coverage is deliberately split into five execution lanes (`execution:pull_request`, `execution:scheduled`, `execution:protected`, `execution:mutation`, and `execution:trusted_issue`) and four generated templates under `template:<id>`. Prefixing the identities prevents a template from masking a missing execution lane with the same name. Each template also binds the normalized template contents by SHA-256, so keeping its path while weakening its generated behavior fails parity. Mutation metadata and the complete deterministic selector/flow primitive set are likewise frozen as reviewed capability domains. The operational pipeline generates the receipt immediately before its final complete artifact-index refresh.

`artifactSurfaces` is intentionally separate from `evidenceResources`. It freezes every supported `.visual-hive` file, directory, and dynamic path pattern, including Markdown sidecars, diagnostics, history snapshots, agent packets, provider uploads, and Hive handoff outputs even when they are not exposed through MCP. Each entry binds its surface kind, diagnostic roles, producer contract, and evidence-resource identity when one exists. Source, documentation, generator, and full-demo declarations are checked exhaustively against the registry, while the registry is independently compared with the reviewed hashes in the frozen baseline; adding or removing an output cannot pass by changing only one list.

```bash
visual-hive capabilities --format json
```

Source checkouts discover `schemas/` from the repository. Release bundles discover the schemas shipped beside `visual-hive.mjs`; consumers do not need a source checkout. `--schemas-dir <path>` is available for an explicit packaged-schema location.

`status` is the parity gate. It is `failed` when a baseline capability is missing or changed, or when an unreviewed capability appears. `runtimeStatus` is separate: `blocked` means at least one reviewed lane is intentionally unavailable at runtime. Each unavailable lane remains in `checks` with `status: "blocked"` and a reason; it is never silently omitted or presented as supported.

Provider support is also recorded per operation. The guarded Argos upload path is implemented and therefore Argos is not marked wholly blocked. Its deferred hosted `compare` and `fetch_result` operations remain explicit blocked operations with reasons. Playwright remains the deterministic verdict authority; supplemental provider availability or upload does not replace its verdict.

When a public surface changes, update its implementation, schema or registry first, then review and update `VISUAL_HIVE_CAPABILITY_BASELINE`. The focused parity tests must prove the dynamic surface and frozen baseline match. Do not update the baseline merely to make a failing gate green; confirm the change preserves Visual Hive's deterministic verdict authority and standalone capability first.

Maintainers can check the complete live surface deterministically with:

```bash
npm run capability-baseline:check
```

That command builds only the three packages needed for inventory, prints every drifted record, and exits nonzero on drift. For a deliberate additive change, generate a review artifact without modifying the checked-in baseline:

```bash
npm run capability-baseline:candidate -- \
  --review-reason "add test-creation plan v2" \
  --confirm-intent accept-capability-drift
```

The candidate is written under ignored `.visual-hive/` state and contains the full deterministic inventory plus each mismatch. Review it, copy only the intended entries into `packages/core/src/capabilities/baseline.ts`, rerun `capability-baseline:check`, and commit the implementation, schema, baseline, and negative regression together. Candidate generation refuses a missing reason, the exact confirmation token, or a no-op update; it never rewrites the baseline silently.
