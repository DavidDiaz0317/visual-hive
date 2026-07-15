# Hive + Visual Hive SWE-bench Multimodal Protocol

Status: preregistered development protocol v2

Frozen: 2026-07-14

Evaluation state at v2 freeze: not begun. No untouched-evaluation task has been opened, executed, inspected, or used for a product or protocol decision.

Private test submissions: out of scope for this protocol

Protocol v2 supersedes v1 before evaluation. It does not change the dataset, repository-grouped split, prompts, treatment definition, or evaluation instances. It freezes the previously unresolved dollar ceiling, restores numeric cost and infrastructure acceptance caps, defines the confirmatory uncertainty rule, and defines zero-control handling for relative uplift and cost efficiency. No result was available when these rules were set.

## Claim under test

For the same task, repository state, issue images, repair agent, model, ordinary tools, budgets, and validation policy, adding Visual Hive's task-specific evidence tools and deterministic reproduce/validate loop improves SWE-bench Multimodal resolution without an unacceptable increase in cost or infrastructure failure.

The experiment measures the incremental value of Visual Hive. It does not compare an image-blind control with an image-aware treatment. Both conditions receive the original task images using the same native multimodal representation.

## Immutable benchmark inputs

| Input | Pinned identity |
| --- | --- |
| Dataset | `SWE-bench/SWE-bench_Multimodal` |
| Dataset revision | `6051de316c9dbe807322d568d9dc5f465b33a96f` |
| Development parquet | `data/dev-00000-of-00001.parquet` |
| Development parquet SHA-256 | `1d120ea3f28708d453f25b17e0589112f163e8ceef4e8e2b6293407376bc3a4b` |
| Development rows | 102 |
| Lexicographically ordered instance-list SHA-256 | `4515c666144dcfbd29dc899c42a21c0bb8486328347aae642cfedbd3c70e78c6` |
| Official evaluator repository | `SWE-bench/SWE-bench` |
| Evaluator revision | `f7bbbb2ccdf479001d6467c9e34af59e44a840f9` |
| Official submission client | `SWE-bench/sb-cli` |
| Submission-client revision | `b679692b8b7e274a6c89fd0842f25b02da4b9256` |

The exact task partitions and their hashes are committed in [`swebench-multimodal-split.v1.json`](./swebench-multimodal-split.v1.json). A run is invalid if the downloaded parquet, instance inventory, base commits, or partition hashes differ.

The official evaluator remains the resolution oracle. Visual Hive's verdict is a product measurement and repair gate; it does not replace `FAIL_TO_PASS` and `PASS_TO_PASS` grading.

## Repository-grouped development split

Repository leakage is prevented by assigning every task from a repository to exactly one partition. Repositories were ranked before results existed by:

```text
sha256("hive-visual-hive-swebench-mm-v1\n" + repository + "\n")
```

Repositories were added to the untouched evaluation partition in ascending hash order until it contained at least half of the 102 development tasks. This produced two balanced 51-task partitions:

- Tuning: `chartjs/Chart.js`, `diegomura/react-pdf`, and `processing/p5.js`.
- Untouched evaluation: `Automattic/wp-calypso` and `markedjs/marked`.

The three-task smoke and fifteen-task pilot are deterministic subsets of tuning only. Within each tuning repository, instances are ranked by:

```text
sha256("hive-visual-hive-swebench-mm-pilot-v1\n" + instance_id + "\n")
```

The first instance per repository is the smoke set and the first five per repository are the pilot. Evaluation tasks must not be opened, executed, inspected, or used for product decisions until the implementation, prompts, schemas, routing, and budgets are frozen.

## Conditions

### Control

- Existing Hive repair agent and ordinary repair capabilities.
- Original task text and original task images.
- No Visual Hive-derived task context, evidence query, targeted capture, comparison, or repair-validation tools.
- The same deterministic repository tests and official grader used by treatment.

### Treatment

- The identical Hive repair agent, model, prompt body, source context, task text, task images, ordinary tools, patch policy, and official grader.
- The only additional capability is the versioned Visual Hive context/tool interface and its deterministic reproduce/capture/compare/validate loop.
- Visual Hive's optional LLM triage is disabled for the primary causal comparison. Any later full-product comparison that invokes another model is reported separately and includes its cost.

Each pair starts from fresh, independently materialized workspaces. Conditions may share immutable downloaded repository objects, but never working trees, generated evidence, screenshots, baselines, histories, caches, conversations, or repair trajectories.

## Frozen execution policy

- Paired repetitions: three.
- Run-order seeds: `1729`, `3253`, and `7919`.
- Condition order: deterministically shuffled per task and repetition from the run-order seed.
- Maximum repair attempts: three per condition.
- Maximum model time: 20 minutes per attempt.
- Maximum validation-command time: 15 minutes per command.
- Maximum total session time: 45 minutes per condition.
- Maximum combined model tokens: 100,000 per condition.
- Maximum model output tokens: 25,000 per condition.
- Maximum Visual Hive calls: 20 in treatment; every call counts against the same total token and wall-time budgets.
- Maximum image fetches: 12 in treatment, with content deduplicated by SHA-256.
- Maximum treatment-only evidence payload: 32 MiB binary and 2 MiB UTF-8 text per task.
- Maximum billed provider cost: USD 2.50 per condition, therefore USD 5.00 per paired task-repetition. A run lock may lower but never raise this cap. The corresponding hard stage ceilings are USD 15.00 for smoke, USD 225.00 for the 15-task/three-repetition pilot, and USD 765.00 for the 51-task/three-repetition untouched evaluation. Tuning beyond the pilot requires a separate authorization and cannot increase the untouched-evaluation ceiling.

Cost includes every billed model/provider call made for the condition, including retries and any optional model used by the condition. Local browser, container, and evaluator compute is reported separately and is not silently converted into provider cost. If the selected provider cannot expose and enforce token and billed-cost usage, or any completed evaluation condition has missing usage, that run is a plumbing result and cannot support the performance claim. Missing usage is never zero. Provider revision, model snapshot, effective sampling settings, Codex/agent version, prompts, tool schemas, Hive SHA, Visual Hive SHA, container images, OS, architecture, Node, Playwright, browser, fonts, locale, timezone, and evaluator revision must be captured in the immutable run lock.

No material-cost pilot or evaluation run starts until its task count, call count, expected duration, maximum cost, and expected cost have been shown to the user and explicitly authorized.

## Leakage controls

- Solving has no outbound network access. Prefetched task images and package/repository inputs are content-addressed before isolation; localhost is allowed only for the repository application and Visual Hive sidecar.
- Both conditions receive byte-identical task images, verified by digest.
- Remove remotes, later branches/tags, reflogs, alternate object stores, and unreachable future objects from task workspaces.
- Never expose development `patch`, `test_patch`, `FAIL_TO_PASS`, or `PASS_TO_PASS` fields to either agent.
- Never expose evaluation trajectories, known solutions, future commits, or another condition's artifacts.
- Do not approve a buggy base rendering as a baseline merely because no baseline exists.
- Audit final patches for generated evidence, benchmark-specific conditionals, test manipulation, unrelated dependency changes, and task-answer leakage.
- The final run manifest records a zero/nonzero forbidden-action count. Any nonzero leakage count invalidates the affected pair.

## Run stages

1. **Fixture gate:** product-owned end-to-end fixtures prove image ingestion, tool use, minimal repair, deterministic comparison, fail-closed comparability, and control-path compatibility.
2. **Smoke:** three tuning tasks, one per tuning repository, one paired repetition. Used only to prove plumbing and artifact completeness.
3. **Pilot:** fifteen tuning tasks, three paired repetitions. Used to diagnose routing, tool usability, cost, and infrastructure behavior.
4. **Tuning:** remaining tuning tasks may be used for bounded product improvement. Leave-one-repository-out results must be retained.
5. **Freeze:** commit code, prompts, schemas, routing, budgets, environment images, and the complete run lock.
6. **Evaluation:** all 51 untouched tasks, three paired repetitions. Run each pair interleaved. No product or protocol change is permitted after the first evaluation task starts.
7. **Private test:** excluded. A later Goal may generate both full prediction files before viewing either score and may submit through official `sb-cli` only after separate quota and cost authorization.

An interrupted run resumes from content-addressed receipts. It must not rerun or overwrite a completed condition unless the entire affected pair is invalidated and reported.

## Outcomes and statistics

Primary outcome is official task resolution: every fail-to-pass test passes and every pass-to-pass test remains passing.

For each task, a repetition records control/treatment resolution, patch application, empty-patch status, F2P/P2P results, agent-declared success, Visual Hive verdict, infrastructure class, wall time, tokens, cost, attempts, tool calls, files inspected, files changed, changed lines, and unrelated-diff result.

The frozen evaluation report includes:

- micro and repository-macro resolve rates;
- absolute treatment-minus-control resolve-rate difference;
- treatment-only wins, control-only wins, and net paired wins;
- exact two-sided McNemar test over discordant task outcomes after reducing each task's three repetitions to its majority outcome;
- 10,000-draw paired bootstrap confidence interval over task clusters, retaining all three repetitions for each sampled task, stratified by repository and seeded with `20260714`;
- F2P, P2P, patch-application, empty-patch, timeout, cost-limit, and infrastructure-failure rates;
- tokens, dollars, wall time, and tool calls per task and per resolved task;
- files inspected/changed, changed lines, unrelated-diff rate, and development-only localization metrics;
- results by repository, asset type, native visual-test grading, and Visual Hive routing decision;
- treatment tool contribution: requested, successful, consumed by the model, and followed by a changed action or validated patch.

Cost per solve is total condition cost divided by resolved task-repetitions. Infrastructure failures remain unresolved in the primary denominator and are also reported separately. A harness, provider, image-prefetch, repository-materialization, browser-startup, evaluator, timeout, or cost-limit failure is infrastructure; a patch that applies but fails tests is an ordinary unresolved task. Missing usage data is not treated as zero.

The sole confirmatory significance rule is that the lower endpoint of the preregistered paired 95% task-cluster bootstrap interval for treatment minus control is strictly greater than zero. The exact two-sided McNemar p-value is a required sensitivity analysis, not an alternative gate: it cannot rescue an interval containing zero, and a different conclusion must be reported rather than selectively replacing the bootstrap rule. No post-hoc normal approximation, one-sided test, repository exclusion, repetition exclusion, or seed change is allowed.

Relative uplift is `(treatment resolve rate - control resolve rate) / control resolve rate` when the control rate is positive. When control is zero and treatment is also zero, relative uplift is defined as zero and the claim fails. When control is zero and treatment is positive, relative uplift is reported as `undefined (control=0)`, never as infinity; the 10% relative criterion is considered satisfied only when the absolute-improvement and confirmatory-bootstrap criteria also pass.

When control has no solves, the cost-per-solve ratio is also reported as undefined. Its preregistered fallback is total billed cost per task: treatment must be no more than 25% above control and must remain below the absolute USD 2.50 condition cap. If control billed cost is zero, treatment must also have zero billed cost for this fallback to pass.

## Preregistered acceptance

Treatment passes the performance claim only if all are true on the untouched evaluation partition:

- absolute resolve-rate improvement is at least 5 percentage points;
- relative resolve-rate improvement is at least 10% over control;
- the lower endpoint of the preregistered paired 95% task-cluster bootstrap interval is strictly greater than zero;
- repository-macro improvement is positive;
- cost per resolved task is no more than 25% worse, using the frozen zero-control fallback above when required;
- infrastructure-failure rate is at most 5% in each condition and treatment is no more than 1 percentage point worse than control;
- invalid, unrelated, and deterministically regressive patch counts do not increase;
- leakage and forbidden-action counts are zero.

These thresholds are immutable. A failed result is reported as a failed hypothesis, not repaired by changing metrics, excluding difficult repositories, weakening budgets, or tuning on evaluation tasks.

## Required artifacts

Every condition emits a canonical manifest linking:

- protocol and split-manifest digests;
- task/repository/base identities and task-image digests;
- condition, repetition, order seed, agent/model/provider identities, and budgets;
- Hive, Visual Hive, prompt, tool-schema, environment, and evaluator identities;
- input inventory and leakage audit;
- attempt/tool transcript digests;
- patch and changed-file digests;
- Visual Hive before/after evidence and comparable validation receipt;
- official evaluator report;
- timing, token, cost, failure, and outcome records.

Raw artifacts are immutable and content-addressed. Human-readable Markdown is derived from, and links back to, canonical JSON. Generated benchmark artifacts remain outside the default CLI path and are not committed unless intentionally reduced to reviewed fixtures.

## Sources

- [Official SWE-bench Multimodal dataset](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal)
- [Official SWE-bench evaluator](https://github.com/SWE-bench/SWE-bench)
- [Official `sb-cli`](https://github.com/SWE-bench/sb-cli)
- [SWE-bench Multimodal benchmark](https://www.swebench.com/multimodal)
- [SWE-bench Multimodal paper](https://proceedings.iclr.cc/paper_files/paper/2025/file/07d6332ae36730707fddddba736d7b6c-Paper-Conference.pdf)
