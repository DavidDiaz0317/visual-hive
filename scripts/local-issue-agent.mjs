#!/usr/bin/env node

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const profile = process.env.VISUAL_HIVE_AGENT_PROFILE ?? "unknown";
  const dedupe = process.env.VISUAL_HIVE_AGENT_ISSUE_DEDUPE ?? "unknown";
  const validationCommand = process.env.VISUAL_HIVE_AGENT_VALIDATION_COMMAND ?? "visual-hive validate";
  const allowWrite = process.env.VISUAL_HIVE_AGENT_ALLOW_WRITE === "true";
  const allowNetwork = process.env.VISUAL_HIVE_AGENT_ALLOW_EXTERNAL_NETWORK === "true";
  const title = input.match(/^Issue:\s*(.+)$/m)?.[1] ?? "Visual Hive issue";
  const contracts = input.match(/Affected contracts:\s*(.+)$/m)?.[1] ?? "not recorded";
  const routes = input.match(/Affected routes:\s*(.+)$/m)?.[1] ?? "not recorded";
  const artifacts = [...input.matchAll(/^- (\.visual-hive\/[^\s`]+)/gm)].map((match) => match[1]).slice(0, 6);

  if (allowWrite || allowNetwork) {
    console.error("local Visual Hive issue agent refuses write or network-enabled runs");
    process.exit(2);
  }

  const response = {
    summary: `No-write local analysis for ${title}.`,
    diagnosis: `Use the linked Visual Hive evidence to inspect ${contracts} on ${routes}. This is an advisory repair plan only; Visual Hive remains the deterministic verdict authority.`,
    proposedFilesToInspect: [
      "visual-hive.config.yaml",
      ".visual-hive/evidence-packet.json",
      ".visual-hive/visual-graph.json",
      ".visual-hive/visual-impact.json"
    ],
    proposedChanges: [
      "Inspect the affected route/contract/selector before changing application code.",
      "Add or tighten the smallest deterministic contract that would prove the issue is fixed.",
      "Rerun the validation command after any future trusted write-preview work."
    ],
    validationCommand,
    risks: [
      "Do not approve baselines blindly.",
      "Do not weaken screenshot thresholds, selector assertions, mutation thresholds, or workflow safety gates."
    ],
    writeAccessNeeded: false,
    confidence: "medium",
    graphNodesUsed: [],
    artifactsUsed: artifacts,
    safetyNotes: [
      "No files changed.",
      "No network calls made.",
      "No GitHub issues created.",
      "No branches, commits, pull requests, provider uploads, Hive API calls, or LLM calls made."
    ],
    profile,
    dedupe
  };

  console.log(JSON.stringify(response, null, 2));
});
