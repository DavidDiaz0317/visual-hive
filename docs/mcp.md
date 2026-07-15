# Visual Hive MCP

Visual Hive MCP is a first-party read-only interface over Visual Hive artifacts. It gives Codex, Hive, and other agents a bounded way to read issue context, evidence, graph impact, validation commands, and handoff state without making them verdict authorities.

Visual Hive remains the deterministic verdict layer. MCP tools do not run targets, mutate source, approve baselines, create GitHub issues, create Hive Beads, upload provider artifacts, or decide pass/fail by default.

## Run It

Generate a manifest:

```bash
node packages/cli/dist/index.js mcp --config examples/demo-react-app/visual-hive.config.yaml --describe --output .visual-hive/mcp-manifest.json
```

Start the stdio server for an MCP client:

```bash
node packages/cli/dist/index.js mcp --config examples/demo-react-app/visual-hive.config.yaml --stdio
```

Run the product MCP smoke test:

```bash
npm run demo:mcp
npm run demo:mcp:smoke
```

The smoke test reads real Visual Hive artifacts, verifies the manifest, exercises at least ten read-only resources/tools, and confirms execution/write-capable tools are listed as disabled rather than callable. It also starts `node packages/cli/dist/index.js mcp --stdio` as a bounded subprocess through the MCP SDK `StdioClientTransport`, then verifies that a real MCP client can initialize, list resources/tools, read `visual-hive://issues`, call `visual_hive_list_issues`, and close cleanly with zero network or external calls.

For first-time setup before a config exists, use manifest-only repo mode:

```bash
node packages/cli/dist/index.js mcp --repo ../target-repo --describe --output .visual-hive/mcp-manifest.json
```

Repo mode does not start `--stdio`, write config, run tests, create issues, call Hive, call providers, or enable setup writes.

## Issue Resources

The issue-centric MCP path uses these product-facing resources:

- `visual-hive://issues`
- `visual-hive://issue-queue`
- `visual-hive://visual-graph`
- `visual-hive://visual-impact`
- `visual-hive://evidence-packet`
- `visual-hive://report`
- `visual-hive://mutation-report`
- `visual-hive://triage`
- `visual-hive://handoff`
- `visual-hive://hive-export`
- `visual-hive://artifact-index`

Compatibility resources such as `visual-hive://latest-evidence`, `visual-hive://latest-report`, `visual-hive://visual-graph-impact`, `visual-hive://triage-report`, `visual-hive://latest-handoff`, and `visual-hive://artifacts/index` remain available.

## Issue Tools

Use these read-only tools for issue agents:

- `visual_hive_list_issues`
- `visual_hive_get_issue_context`
- `visual_hive_read_issue_queue`
- `visual_hive_query_visual_graph`
- `visual_hive_get_visual_impact`
- `visual_hive_read_evidence_packet`
- `visual_hive_read_mutation_report`
- `visual_hive_list_artifacts`
- `visual_hive_get_validation_command`
- `visual_hive_get_agent_prompt`
- `visual_hive_get_handoff_context`
- `visual_hive_read_report`
- `visual_hive_read_triage`
- `visual_hive_read_artifacts_index`

The intended flow is:

1. Start from an issue candidate or GitHub issue.
2. Read `visual_hive_get_issue_context`.
3. Follow the issue queue, Visual Graph, impact, Evidence Packet, mutation report, and artifact index.
4. Use `visual_hive_get_validation_command` before proposing any write-preview change.
5. Use `visual_hive_get_handoff_context` only when the issue routes to trusted GitHub or Hive handoff.

`visual_hive_get_issue_context` now requires the exact task identity, task-context digest, repository, and issue fingerprint. It never selects the first active issue. Legacy zero-argument callers receive an identity-required response.

## Multimodal Repair Tools

Hive treatment sessions receive exactly these read-only Visual Hive tools:

- `visual_hive_get_task_context`
- `visual_hive_get_issue_context`
- `visual_hive_search_surface`
- `visual_hive_get_visual_asset`
- `visual_hive_get_screenshot_set`
- `visual_hive_get_browser_evidence`
- `visual_hive_compare_assets`
- `visual_hive_get_repair_validation`

The repair server is separate from the general artifact MCP server. Its store must already exist as an ordinary canonical directory, and its session must be an authorized `hive.repair-session.v1` snapshot with `effectiveMode: visual_hive`. Print the exact scoped manifest or start stdio with:

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

After normal MCP initialization, an exact task-context call has this logical JSON-RPC shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "visual_hive_get_task_context",
    "arguments": {
      "taskId": "task.card-layout",
      "repository": "owner/repo",
      "taskContextDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "baseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "section": "summary",
      "cursor": 0,
      "limit": 20,
      "maxChars": 16000
    }
  }
}
```

The server checks every supplied identity against the signed session and returns the session/task/repository binding with the result. Changing only a digest, commit, repository, task, authorization window, or unapproved tool name is an error rather than a request for best-effort matching.

Every call requires a repository, task ID, and canonical task-context digest. Run-backed calls additionally require the exact run-context digest and commit. Receipt retrieval requires the finding, repair head, and receipt digest. Callers provide identities only; filesystem paths are never accepted.

Artifacts are stored below a content-addressed repair-session directory. Reads reject traversal, symlinks, oversized content, digest drift, repository drift, stale commits, ambiguous issue identities, and ambiguous screenshot roles. Image tools return raw MCP image blocks plus a compact JSON text fallback. Comparison uses `pixelmatch.v7.threshold-0.1.include-aa-false.diagnostic-v2` in memory, reports exact before/after dimensions and changed bounds, renders added/removed/changed regions with fixed diagnostic colors, and cannot accept a caller-supplied threshold.

These tools never execute Playwright, modify baselines, write source, call GitHub, or decide lifecycle state. Hive brokers declared reproduction and validation profiles; Visual Hive's deterministic receipt remains the visual oracle.

### Hive broker boundary

The model must not launch or connect to this server directly in an authoritative repair. Hive owns the stdio child, validates the model's structured request against the frozen tool schema and authorization, enforces turn/tool/image/text/time budgets, records the request and terminal result digest, and supplies only that bounded result to the next model turn. The MCP child receives no GitHub token and no repository write authority.

Repair MCP performs artifact reads and comparisons only, so it never substitutes for the execution sandbox. `visual-hive repair capture` must be launched separately by Hive inside the operating-system broker boundary documented in [`repair-session-integration.md`](./repair-session-integration.md): repository code cannot reach Hive-owned authorization/result paths or sibling environment, and its complete process tree is owned and terminated by a Job Object, container, or cgroup-equivalent boundary. Without that boundary, capture is local evidence only and cannot authorize publication or merge.

## Disabled Execution

These execution or write-capable tools are described in the manifest as disabled by default:

- `visual_hive_run`
- `visual_hive_mutate`
- `visual_hive_update_baseline`
- `visual_hive_handoff_github_issue`
- `visual_hive_handoff_hive_bead`
- `visual_hive_hive_repair`
- `visual_hive_provider_upload`
- `visual_hive_apply_patch`
- `visual_hive_open_pr`

Trusted workflows may call the CLI directly under explicit policy. MCP clients should treat the default server as read-only context.

## Safety Rules

- Issues are the durable work queue.
- Visual Hive artifacts are the evidence source.
- MCP is the structured read path over that evidence.
- Playwright is the default first-party local browser evidence runner.
- Visual Hive owns the final deterministic verdict.
- LLMs, MCP clients, Hive, agents, and optional providers do not override pass/fail.
- Default local and PR-safe runs create zero real GitHub issues, branches, PRs, provider uploads, Hive calls, or external network calls.
