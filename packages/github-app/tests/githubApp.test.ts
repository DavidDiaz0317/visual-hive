import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertLeastPrivilegePermissions,
  buildIssuePayloadFromArtifactSummary,
  buildSetupIssuePayload,
  getVisualHiveGitHubAppPermissions,
  handleVisualHiveGitHubAppWebhook,
  verifyGitHubWebhookSignature,
  type GitHubIssuePayload
} from "../src/index.js";

const issueCandidate = {
  issueKind: "mutation_survivor",
  severity: "high",
  status: "open_candidate",
  dedupeFingerprint: "visual-hive:mutation_survivor:force-login-on-demo",
  title: "[Visual Hive] Mutation survived: force-login-on-demo",
  labels: ["visual-hive", "mutation-survivor", "hive/quality"],
  body: "Failure context token=super-secret access_token=abc123 should be redacted.",
  owningAgentHint: "visual-hive/test-creator",
  sourceArtifacts: [".visual-hive/mutation-report.json"],
  affected: [{ route: "/", contractId: "hosted-demo-never-login", selector: "[data-testid='login-page']", viewport: "desktop" }],
  reproductionCommand: "visual-hive mutate",
  validationCommand: "visual-hive mutate --enforce-min-score",
  linkedEvidencePacket: ".visual-hive/evidence-packet.json",
  linkedRepoMap: ".visual-hive/repo-map.json",
  linkedMutationReport: ".visual-hive/mutation-report.json",
  linkedHandoff: ".visual-hive/handoff.json",
  linkedHiveExport: ".visual-hive/hive/hive-export.json",
  linkedKnowledgeGraph: ".visual-hive/hive/knowledge-graph.json",
  linkedAgentPacket: ".visual-hive/agent-packet.json",
  guardrails: ["Do not weaken thresholds.", "Do not approve baselines blindly."]
} as const;

describe("Visual Hive GitHub App prototype", () => {
  it("models least-privilege default permissions and flags elevated write permissions", () => {
    const permissions = getVisualHiveGitHubAppPermissions();
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "metadata", access: "read" }),
        expect.objectContaining({ name: "contents", access: "read" }),
        expect.objectContaining({ name: "actions", access: "read" }),
        expect.objectContaining({ name: "checks", access: "read" }),
        expect.objectContaining({ name: "issues", access: "write" }),
        expect.objectContaining({ name: "pull_requests", access: "none" }),
        expect.objectContaining({ name: "workflows", access: "none" })
      ])
    );
    expect(assertLeastPrivilegePermissions(permissions).passed).toBe(true);

    const elevated = getVisualHiveGitHubAppPermissions({ directContentWrites: true, directWorkflowWrites: true });
    const audit = assertLeastPrivilegePermissions(elevated);
    expect(audit.passed).toBe(false);
    expect(audit.findings.join("\n")).toContain("workflows:write");
    expect(audit.findings.join("\n")).toContain("contents:write");
  });

  it("verifies GitHub webhook signatures with timing-safe sha256 comparison", () => {
    const secret = "webhook-secret";
    const payload = JSON.stringify({ action: "created" });
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(secret, payload, signature)).toBe(true);
    expect(verifyGitHubWebhookSignature(secret, payload, "sha256=bad")).toBe(false);
    expect(verifyGitHubWebhookSignature(secret, payload, undefined)).toBe(false);
  });

  it("creates setup issue actions from installation events without executing repo code", () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "installation",
      deliveryId: "delivery-1",
      receivedAt: new Date("2026-07-05T12:00:00.000Z"),
      payload: {
        repositories: [{ full_name: "DavidDiaz0317/visual-hive-demo-site", default_branch: "main" }]
      }
    });

    expect(result.schemaVersion).toBe("visual-hive.github-app.webhook-result.v1");
    expect(result.externalCallsMade).toBe(0);
    expect(result.networkCallsMade).toBe(0);
    expect(result.checkoutPerformed).toBe(false);
    expect(result.repoCodeExecuted).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      action: "create_setup_issue",
      repository: "DavidDiaz0317/visual-hive-demo-site"
    });
    expect(result.actions[0].issuePayload?.title).toBe("[Visual Hive] Setup visual QA");
    expect(result.actions[0].issuePayload?.labels).toContain("hive/quality");
    expect(result.actions[0].issuePayload?.body).toContain("pull_request");
  });

  it("maps trusted workflow artifact summaries to sanitized issue payloads", () => {
    const result = handleVisualHiveGitHubAppWebhook({
      eventName: "workflow_run",
      payload: {
        repository: { full_name: "DavidDiaz0317/visual-hive-demo-site" },
        workflow_run: { conclusion: "failure" },
        visual_hive_artifact_summary: {
          issueCandidate
        }
      }
    });

    expect(result.actions[0]).toMatchObject({
      action: "create_or_update_visual_hive_issue",
      repository: "DavidDiaz0317/visual-hive-demo-site"
    });
    const payload = result.actions[0].issuePayload as GitHubIssuePayload;
    expect(payload.dedupeFingerprint).toBe("visual-hive:mutation_survivor:force-login-on-demo");
    expect(payload.body).toContain("Validation command");
    expect(payload.body).toContain("visual-hive mutate --enforce-min-score");
    expect(payload.body).toContain("Dedupe fingerprint");
    expect(payload.body).not.toContain("super-secret");
    expect(payload.body).not.toContain("abc123");
    expect(payload.body).toContain("[REDACTED]");
  });

  it("builds setup and artifact issue payloads with explicit Visual Hive boundaries", () => {
    const setup = buildSetupIssuePayload({
      repository: { fullName: "DavidDiaz0317/visual-hive-demo-site" },
      detectedFrameworks: ["react", "vite"]
    });
    expect(setup.body).toContain("Visual Hive detects, proves, packages, and routes");
    expect(setup.body).toContain("does not repair code");

    const issue = buildIssuePayloadFromArtifactSummary({
      repository: { fullName: "DavidDiaz0317/visual-hive-demo-site" },
      candidate: issueCandidate
    });
    expect(issue.labels).toEqual(expect.arrayContaining(["visual-hive", "mutation-survivor", "hive/quality"]));
    expect(issue.body).toContain("Owning agent hint: visual-hive/test-creator");
    expect(issue.body).toContain("Do not approve baselines blindly.");
  });
});
