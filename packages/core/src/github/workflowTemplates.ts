export interface GitHubWorkflowTemplate {
  id: "pull_request" | "scheduled" | "trusted_failure_issue" | "trusted_hive_handoff";
  label: string;
  path: string;
  description: string;
  safetyNotes: string[];
  content: string;
}

export const prWorkflowTemplate = `name: Visual Hive PR

on:
  pull_request:

permissions:
  contents: read

jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - uses: DavidDiaz0317/visual-hive/actions/run@main
        with:
          command: pipeline
          arguments: --mode pr --base origin/main --ci --github-step-summary
      # Do not create issues from untrusted PR execution. Upload artifacts and let
      # a trusted workflow_run workflow consume them if issue creation is needed.
      # For stricter supply-chain hardening, pin actions by SHA instead of tags.
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`;

export const failureIssueWorkflowTemplate = `name: Visual Hive Failure Issue

on:
  workflow_run:
    workflows:
      - Visual Hive PR
      - Visual Hive Scheduled
    types:
      - completed

permissions:
  actions: read
  issues: write
  contents: read

jobs:
  create-issue:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'failure'
    steps:
      # This trusted workflow does not checkout or execute PR code. It consumes
      # sanitized Visual Hive artifacts, prefers issues.json issue candidates,
      # and falls back to issue.md only when older artifacts are uploaded. For
      # stricter supply-chain hardening, pin third-party actions by SHA.
      - uses: actions/download-artifact@v4
        with:
          name: visual-hive
          path: visual-hive-artifacts
          run-id: \${{ github.event.workflow_run.id }}
          github-token: \${{ github.token }}
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require("fs");
            const path = require("path");
            const crypto = require("crypto");
            const artifactRoot = "visual-hive-artifacts";

            function walkArtifacts(dir) {
              if (!fs.existsSync(dir)) return [];
              return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
                const fullPath = path.join(dir, entry.name);
                return entry.isDirectory() ? walkArtifacts(fullPath) : [fullPath];
              });
            }

            const artifactFiles = walkArtifacts(artifactRoot);
            function findArtifact(name) {
              const normalizedSuffix = "/" + name;
              return artifactFiles.find((file) => file.replace(/\\\\/g, "/").endsWith("/.visual-hive/" + name))
                || artifactFiles.find((file) => file.replace(/\\\\/g, "/").endsWith(normalizedSuffix))
                || artifactFiles.find((file) => path.basename(file) === name);
            }

            function findIssueBody() {
              const issuePath = findArtifact("issue.md");
              return issuePath && fs.existsSync(issuePath) ? issuePath : undefined;
            }

            function findIssuesReport() {
              const issuesPath = findArtifact("issues.json");
              return issuesPath && fs.existsSync(issuesPath) ? issuesPath : undefined;
            }

            function redactSecretValues(value) {
              return String(value)
                .replace(/((?:access_token|id_token|refresh_token|token|password|secret|key|code|client_secret)\\s*[:=]\\s*)[^\\s"'&]+/gi, "$1[REDACTED]")
                .replace(/(authorization\\s*:\\s*(?:bearer\\s+)?)\\S+/gi, "$1[REDACTED]")
                .replace(/\\bBearer\\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
                .replace(/((?:set-cookie|cookie)\\s*:\\s*)[^\\n\\r]+/gi, "$1[REDACTED]");
            }

            function readJsonArtifact(name) {
              const artifactPath = findArtifact(name);
              if (!artifactPath || !fs.existsSync(artifactPath)) return undefined;
              try {
                return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
              } catch {
                return undefined;
              }
            }

            const issuePath = findIssueBody();
            const issuesReportPath = findIssuesReport();
            const issuesReport = issuesReportPath ? readJsonArtifact("issues.json") : undefined;
            const issueCandidates = Array.isArray(issuesReport?.issues)
              ? issuesReport.issues
                  .filter((issue) => issue.status === "open_candidate" || issue.status === "update_candidate" || issue.status === "resolved_candidate")
                  .slice(0, 10)
              : [];
            if (issuesReport && (issuesReport.externalCallsMade !== 0 || issuesReport.networkCallsMade !== 0)) {
              throw new Error("Refusing trusted issue publication because issues.json reports prior external/network calls.");
            }
            if (issueCandidates.length) {
              const { data: openIssues } = await github.rest.issues.listForRepo({
                owner: context.repo.owner,
                repo: context.repo.repo,
                state: "open",
                labels: "visual-hive"
              });
              for (const candidate of issueCandidates) {
                const marker = "<!-- visual-hive-issue dedupe:" + String(candidate.dedupeFingerprint || "missing") + " -->";
                const body = redactSecretValues(String(candidate.body || "")).includes("visual-hive-issue dedupe:")
                  ? redactSecretValues(String(candidate.body || ""))
                  : marker + "\\n" + redactSecretValues(String(candidate.body || "Visual Hive issue candidate had no body."));
                const labels = [...new Set([...(Array.isArray(candidate.labels) ? candidate.labels : []), "visual-hive"])]
                  .map((label) => redactSecretValues(String(label)).trim())
                  .filter(Boolean)
                  .slice(0, 10);
                const existing = openIssues.find((issue) => issue.body && issue.body.includes(String(candidate.dedupeFingerprint)));
                if (existing) {
                  await github.rest.issues.update({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    issue_number: existing.number,
                    title: redactSecretValues(String(candidate.title || "Visual Hive issue candidate")),
                    labels,
                    body
                  });
                } else if (candidate.status !== "resolved_candidate") {
                  await github.rest.issues.create({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    title: redactSecretValues(String(candidate.title || "Visual Hive issue candidate")),
                    labels,
                    body
                  });
                }
              }
              return;
            }
            const rawBody = issuePath ? fs.readFileSync(issuePath, "utf8") : "Visual Hive failed, but no issue.md artifact was found.";
            const body = redactSecretValues(rawBody);
            const report = readJsonArtifact("report.json");
            const mutationReport = readJsonArtifact("mutation-report.json");
            const triageReport = readJsonArtifact("triage.json");
            const failedContracts = Array.isArray(report?.results)
              ? report.results.filter((result) => result.status === "failed").map((result) => result.contractId).sort()
              : [];
            const survivedMutations = Array.isArray(mutationReport?.results)
              ? mutationReport.results.filter((result) => result.status === "survived").map((result) => result.operator).sort()
              : [];
            const classifications = Array.isArray(triageReport?.findings)
              ? triageReport.findings.map((finding) => finding.classification).sort()
              : [];
            const signatureSource = JSON.stringify({
              workflow: context.payload.workflow_run.name,
              project: report?.project || context.repo.repo,
              failedContracts,
              survivedMutations,
              classifications
            });
            const signature = crypto.createHash("sha256").update(signatureSource).digest("hex").slice(0, 16);
            const marker = "<!-- visual-hive-dedupe:" + signature + " -->";
            const title = "Visual Hive failure: " + context.payload.workflow_run.name;
            const { data: issues } = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: "open",
              labels: "visual-hive"
            });
            const existing = issues.find((issue) => issue.body && issue.body.includes(marker));
            if (existing) {
              await github.rest.issues.update({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: existing.number,
                body: marker + "\\n" + body
              });
            } else {
              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title,
                labels: ["visual-hive", "test-failure"],
                body: marker + "\\n" + body
              });
            }
`;

export const hiveHandoffWorkflowTemplate = `name: Visual Hive Hive Handoff

on:
  workflow_run:
    workflows:
      - Visual Hive PR
      - Visual Hive Scheduled
    types:
      - completed

permissions:
  actions: read
  contents: read
  issues: write

jobs:
  trusted-handoff:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'failure'
    steps:
      # This trusted workflow consumes sanitized Visual Hive artifacts only. It
      # does not checkout or execute PR code, and it makes no Hive network call
      # by default. It may create/update a GitHub issue from the sanitized
      # hive-issue.md artifact after handoff validation passes. For stricter
      # supply-chain hardening, pin actions by SHA.
      - uses: actions/download-artifact@v4
        with:
          name: visual-hive
          path: visual-hive-artifacts
          run-id: \${{ github.event.workflow_run.id }}
          github-token: \${{ github.token }}
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require("fs");
            const path = require("path");
            const crypto = require("crypto");
            const artifactRoot = "visual-hive-artifacts";

            function walkArtifacts(dir) {
              if (!fs.existsSync(dir)) return [];
              return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
                const fullPath = path.join(dir, entry.name);
                return entry.isDirectory() ? walkArtifacts(fullPath) : [fullPath];
              });
            }

            const artifactFiles = walkArtifacts(artifactRoot);
            function findArtifact(name) {
              const normalizedSuffix = "/" + name;
              return artifactFiles.find((file) => file.replace(/\\\\/g, "/").endsWith("/.visual-hive/" + name))
                || artifactFiles.find((file) => file.replace(/\\\\/g, "/").endsWith(normalizedSuffix))
                || artifactFiles.find((file) => path.basename(file) === name);
            }

            function redactSecretValues(value) {
              return String(value)
                .replace(/((?:access_token|id_token|refresh_token|token|password|secret|key|code|client_secret)\\s*[:=]\\s*)[^\\s"'&]+/gi, "$1[REDACTED]")
                .replace(/(authorization\\s*:\\s*(?:bearer\\s+)?)\\S+/gi, "$1[REDACTED]")
                .replace(/\\bBearer\\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
                .replace(/((?:set-cookie|cookie)\\s*:\\s*)[^\\n\\r]+/gi, "$1[REDACTED]");
            }

            function readJsonArtifact(name) {
              const artifactPath = findArtifact(name);
              if (!artifactPath || !fs.existsSync(artifactPath)) return undefined;
              try {
                return JSON.parse(redactSecretValues(fs.readFileSync(artifactPath, "utf8")));
              } catch (error) {
                core.warning("Unable to parse " + name + ": " + redactSecretValues(error.message));
                return undefined;
              }
            }

            function readTextArtifact(name) {
              const artifactPath = findArtifact(name);
              if (!artifactPath || !fs.existsSync(artifactPath)) return undefined;
              return redactSecretValues(fs.readFileSync(artifactPath, "utf8"));
            }

            function safeLabels(values) {
              return [...new Set((Array.isArray(values) ? values : [])
                .concat(["visual-hive", "hive/quality", "ai-ready"])
                .map((value) => redactSecretValues(value).trim())
                .filter(Boolean))]
                .slice(0, 10);
            }

            const evidence = readJsonArtifact("evidence-packet.json");
            const handoff = readJsonArtifact("handoff.json");
            const beadRequest = readJsonArtifact("hive-bead-request.json");
            const handoffResult = readJsonArtifact("hive-handoff-result.json");
            const handoffValidation = readJsonArtifact("hive-handoff-validation.json");
            const hiveExport = readJsonArtifact("hive/hive-export.json");
            const guardedRepairPreview = readJsonArtifact("hive/guarded-repair-preview.json");
            const repairRequestEnvelope = readJsonArtifact("hive/repair-request-envelope.json");
            const trustedRepairConsumerSummary = readJsonArtifact("hive/trusted-repair-consumer-summary.json");
            const trustedRepairWorkflowDryRun = readJsonArtifact("hive/trusted-repair-workflow-dry-run.json");
            const issueBody = readTextArtifact("hive-issue.md");
            const blocking = [];
            if (!evidence) blocking.push("Missing .visual-hive/evidence-packet.json artifact.");
            if (!handoff) blocking.push("Missing .visual-hive/handoff.json artifact.");
            if (!beadRequest) blocking.push("Missing .visual-hive/hive-bead-request.json artifact.");
            if (!handoffValidation) blocking.push("Missing .visual-hive/hive-handoff-validation.json artifact.");
            if (!hiveExport) blocking.push("Missing .visual-hive/hive/hive-export.json artifact.");
            if (!guardedRepairPreview) blocking.push("Missing .visual-hive/hive/guarded-repair-preview.json artifact.");
            if (!repairRequestEnvelope) blocking.push("Missing .visual-hive/hive/repair-request-envelope.json artifact.");
            if (!trustedRepairConsumerSummary) blocking.push("Missing .visual-hive/hive/trusted-repair-consumer-summary.json artifact.");
            if (!trustedRepairWorkflowDryRun) blocking.push("Missing .visual-hive/hive/trusted-repair-workflow-dry-run.json artifact.");
            if (!issueBody) blocking.push("Missing .visual-hive/hive-issue.md artifact.");

            const externalCalls = Math.max(
              Number(handoffValidation?.summary?.externalCallsMade ?? 0),
              Number(beadRequest?.externalCallsMade ?? 0),
              Number(handoffResult?.externalCallsMade ?? 0),
              Number(hiveExport?.externalCallsMade ?? 0),
              Number(guardedRepairPreview?.externalCallsMade ?? 0),
              Number(repairRequestEnvelope?.externalCallsMade ?? 0),
              Number(trustedRepairConsumerSummary?.externalCallsMade ?? 0),
              Number(trustedRepairWorkflowDryRun?.externalCallsMade ?? 0)
            );
            const mode = String(hiveExport?.mode ?? beadRequest?.mode ?? handoff?.integration?.mode ?? "unknown");
            if (externalCalls !== 0) {
              blocking.push("Hive handoff artifact claims externalCallsMade=" + externalCalls + "; trusted template expects dry-run artifacts only.");
            }
            if (hiveExport && hiveExport.schemaVersion !== "visual-hive.hive-export.v1") {
              blocking.push("Hive export artifact has unexpected schemaVersion=" + redactSecretValues(hiveExport.schemaVersion ?? "missing") + ".");
            }
            if (guardedRepairPreview && guardedRepairPreview.schemaVersion !== "visual-hive.hive-guarded-repair-preview.v1") {
              blocking.push("Guarded repair preview artifact has unexpected schemaVersion=" + redactSecretValues(guardedRepairPreview.schemaVersion ?? "missing") + ".");
            }
            if (guardedRepairPreview?.policy?.verdictAuthority !== "visual_hive") {
              blocking.push("Guarded repair preview does not preserve Visual Hive as verdict authority.");
            }
            if (guardedRepairPreview?.policy?.repairExecution !== "preview_only_no_execution") {
              blocking.push("Guarded repair preview is not preview-only.");
            }
            if (guardedRepairPreview?.policy?.externalNetworkCalls !== false) {
              blocking.push("Guarded repair preview allows external network calls.");
            }
            if (Array.isArray(guardedRepairPreview?.policy?.forbiddenActions) && !guardedRepairPreview.policy.forbiddenActions.includes("decide_visual_hive_verdict")) {
              blocking.push("Guarded repair preview does not forbid agents from deciding the Visual Hive verdict.");
            }
            if (repairRequestEnvelope && repairRequestEnvelope.schemaVersion !== "visual-hive.hive-repair-request-envelope.v1") {
              blocking.push("Repair request envelope artifact has unexpected schemaVersion=" + redactSecretValues(repairRequestEnvelope.schemaVersion ?? "missing") + ".");
            }
            if (repairRequestEnvelope?.policy?.verdictAuthority !== "visual_hive") {
              blocking.push("Repair request envelope does not preserve Visual Hive as verdict authority.");
            }
            if (repairRequestEnvelope?.policy?.requestExecution !== "trusted_workflow_request_only") {
              blocking.push("Repair request envelope is not trusted-workflow-only.");
            }
            if (repairRequestEnvelope?.policy?.repairExecution !== "not_executed_by_visual_hive") {
              blocking.push("Repair request envelope incorrectly claims Visual Hive executed repair.");
            }
            if (repairRequestEnvelope?.policy?.requiresTrustedWorkflow !== true) {
              blocking.push("Repair request envelope does not require a trusted workflow.");
            }
            if (repairRequestEnvelope?.policy?.externalNetworkCalls !== false) {
              blocking.push("Repair request envelope allows external network calls.");
            }
            if (trustedRepairConsumerSummary && trustedRepairConsumerSummary.schemaVersion !== "visual-hive.hive-trusted-repair-consumer-summary.v1") {
              blocking.push("Trusted repair consumer summary artifact has unexpected schemaVersion=" + redactSecretValues(trustedRepairConsumerSummary.schemaVersion ?? "missing") + ".");
            }
            if (trustedRepairConsumerSummary?.policy?.verdictAuthority !== "visual_hive") {
              blocking.push("Trusted repair consumer summary does not preserve Visual Hive as verdict authority.");
            }
            if (trustedRepairConsumerSummary?.policy?.consumerExecution !== "dry_run_summary_only") {
              blocking.push("Trusted repair consumer summary is not dry-run only.");
            }
            if (trustedRepairConsumerSummary?.policy?.repairExecution !== "not_executed_by_visual_hive") {
              blocking.push("Trusted repair consumer summary incorrectly claims Visual Hive executed repair.");
            }
            if (trustedRepairConsumerSummary?.policy?.branchCreation !== false || trustedRepairConsumerSummary?.policy?.pullRequestCreation !== false || trustedRepairConsumerSummary?.policy?.issueCreation !== false) {
              blocking.push("Trusted repair consumer summary permits write actions.");
            }
            if (trustedRepairConsumerSummary?.policy?.hiveNetworkCalls !== false) {
              blocking.push("Trusted repair consumer summary permits Hive network calls.");
            }
            if (trustedRepairConsumerSummary?.policy?.requiresTrustedWorkflow !== true) {
              blocking.push("Trusted repair consumer summary does not require a trusted workflow.");
            }
            if (trustedRepairWorkflowDryRun && trustedRepairWorkflowDryRun.schemaVersion !== "visual-hive.hive-trusted-repair-workflow-dry-run.v1") {
              blocking.push("Trusted repair workflow dry-run artifact has unexpected schemaVersion=" + redactSecretValues(trustedRepairWorkflowDryRun.schemaVersion ?? "missing") + ".");
            }
            if (trustedRepairWorkflowDryRun?.policy?.verdictAuthority !== "visual_hive") {
              blocking.push("Trusted repair workflow dry-run does not preserve Visual Hive as verdict authority.");
            }
            if (trustedRepairWorkflowDryRun?.policy?.workflowExecution !== "dry_run_only") {
              blocking.push("Trusted repair workflow dry-run is not dry-run only.");
            }
            if (trustedRepairWorkflowDryRun?.policy?.repairExecution !== "not_executed_by_visual_hive") {
              blocking.push("Trusted repair workflow dry-run incorrectly claims Visual Hive executed repair.");
            }
            if (
              trustedRepairWorkflowDryRun?.policy?.checkoutCode !== false ||
              trustedRepairWorkflowDryRun?.policy?.branchCreation !== false ||
              trustedRepairWorkflowDryRun?.policy?.pullRequestCreation !== false ||
              trustedRepairWorkflowDryRun?.policy?.issueCreation !== false
            ) {
              blocking.push("Trusted repair workflow dry-run permits checkout or write actions.");
            }
            if (
              trustedRepairWorkflowDryRun?.policy?.hiveNetworkCalls !== false ||
              trustedRepairWorkflowDryRun?.policy?.providerCalls !== false ||
              trustedRepairWorkflowDryRun?.policy?.visualHiveRerun !== false
            ) {
              blocking.push("Trusted repair workflow dry-run permits external calls or reruns.");
            }
            if (trustedRepairWorkflowDryRun?.policy?.requiresTrustedWorkflow !== true) {
              blocking.push("Trusted repair workflow dry-run does not require a trusted workflow.");
            }
            if (handoffValidation?.status === "blocked") {
              blocking.push("Hive handoff validation is blocked; refusing trusted issue creation.");
            }
            const readiness = handoffValidation?.hiveReadiness;
            if (!readiness) {
              blocking.push("Missing Hive readiness summary in hive-handoff-validation.json.");
            }
            if (readiness?.recommendedMode === "full") {
              blocking.push("Evidence Packet recommended full Hive automation; trusted issue workflow refuses full automation.");
            }
            if (readiness?.fullAutomationBlocked !== true) {
              blocking.push("Full Hive automation is not blocked in the validation artifact.");
            }
            if (readiness?.guardedRepairTrustedOnlyOrBlocked !== true) {
              blocking.push("Guarded Hive repair is not blocked or trusted-only in the validation artifact.");
            }

            await core.summary
              .addHeading("Visual Hive Hive Handoff")
              .addRaw("Trusted workflow_run artifact consumer. No checkout, no PR code execution, no Hive network call by default. GitHub issue creation uses sanitized artifacts only.\\n")
              .addList([
                "Evidence packet: " + (evidence ? "found" : "missing"),
                "Handoff packet: " + (handoff ? "found" : "missing"),
                "Hive bead request: " + (beadRequest ? "found" : "missing"),
                "Handoff validation: " + (handoffValidation?.status ?? "missing"),
                "Hive native export: " + (hiveExport?.schemaVersion ?? "missing"),
                "Guarded repair preview: " + (guardedRepairPreview?.status ?? "missing"),
                "Guarded repair ready: " + String(guardedRepairPreview?.readiness?.canRequestGuardedRepair ?? false),
                "Repair request envelope: " + (repairRequestEnvelope?.status ?? "missing"),
                "Trusted repair request ready: " + String(repairRequestEnvelope?.readiness?.canOpenTrustedRepairRequest ?? false),
                "Trusted repair consumer summary: " + (trustedRepairConsumerSummary?.status ?? "missing"),
                "Trusted repair consumer ready: " + String(trustedRepairConsumerSummary?.readiness?.canStartTrustedRepairWorkflow ?? false),
                "Trusted repair workflow dry-run: " + (trustedRepairWorkflowDryRun?.status ?? "missing"),
                "Trusted repair workflow ready: " + String(trustedRepairWorkflowDryRun?.readiness?.canRunTrustedRepairWorkflow ?? false),
                "Recommended Hive mode: " + redactSecretValues(readiness?.recommendedMode ?? "missing") + " (" + redactSecretValues(readiness?.recommendedStatus ?? "missing") + ")",
                "Hive readiness: " + String(readiness?.readyModes?.length ?? 0) + " ready / " + String(readiness?.trustedOnlyModes?.length ?? 0) + " trusted-only / " + String(readiness?.blockedModes?.length ?? 0) + " blocked",
                "Hive issue body: " + (issueBody ? "found" : "missing"),
                "Handoff mode: " + redactSecretValues(mode),
                "External calls made: " + externalCalls
              ])
              .write();

            if (blocking.length) {
              throw new Error(redactSecretValues(blocking.join(" ")));
            }

            const project = redactSecretValues(String(handoff?.project || evidence?.project || context.repo.repo));
            const verdict = redactSecretValues(String(handoff?.verdict?.visualHiveVerdict || evidence?.verdictSummary?.visualHiveVerdict || "unknown"));
            const workItemKeys = Array.isArray(handoff?.workItems) ? handoff.workItems.map((item) => item.key || item.title).sort() : [];
            const signatureSource = JSON.stringify({
              workflow: context.payload.workflow_run.name,
              project,
              verdict,
              hiveMode: mode,
              guardedRepairStatus: guardedRepairPreview?.status ?? "missing",
              repairRequestEnvelopeStatus: repairRequestEnvelope?.status ?? "missing",
              trustedRepairConsumerSummaryStatus: trustedRepairConsumerSummary?.status ?? "missing",
              trustedRepairWorkflowDryRunStatus: trustedRepairWorkflowDryRun?.status ?? "missing",
              workItemKeys
            });
            const signature = crypto.createHash("sha256").update(signatureSource).digest("hex").slice(0, 16);
            const marker = "<!-- visual-hive-hive-handoff-dedupe:" + signature + " -->";
            const validationSummary = [
              "## Trusted handoff validation",
              "",
              "- Handoff validation: " + handoffValidation.status,
              "- Visual Hive verdict: " + verdict,
              "- External calls made: " + externalCalls,
              "- Recommended Hive mode: " + redactSecretValues(handoffValidation.hiveReadiness?.recommendedMode ?? "missing"),
              "- Hive export mode: " + redactSecretValues(mode),
              "- Guarded repair preview: " + redactSecretValues(guardedRepairPreview?.status ?? "missing"),
              "- Guarded repair ready: " + String(guardedRepairPreview?.readiness?.canRequestGuardedRepair ?? false),
              "- Repair request envelope: " + redactSecretValues(repairRequestEnvelope?.status ?? "missing"),
              "- Trusted repair request ready: " + String(repairRequestEnvelope?.readiness?.canOpenTrustedRepairRequest ?? false),
              "- Trusted repair consumer summary: " + redactSecretValues(trustedRepairConsumerSummary?.status ?? "missing"),
              "- Trusted repair consumer ready: " + String(trustedRepairConsumerSummary?.readiness?.canStartTrustedRepairWorkflow ?? false),
              "- Trusted repair workflow dry-run: " + redactSecretValues(trustedRepairWorkflowDryRun?.status ?? "missing"),
              "- Trusted repair workflow ready: " + String(trustedRepairWorkflowDryRun?.readiness?.canRunTrustedRepairWorkflow ?? false),
              "- Full automation blocked: " + String(handoffValidation.hiveReadiness?.fullAutomationBlocked ?? false),
              "- Trusted workflow: workflow_run artifact consumer",
              "- PR code checkout: false",
              "- Hive API call: false"
            ].join("\\n");
            const body = redactSecretValues(marker + "\\n" + validationSummary + "\\n\\n---\\n\\n" + issueBody).slice(0, 60000);
            const title = "Visual Hive Hive handoff: " + project;
            const labels = safeLabels(handoff?.labels);
            const { data: issues } = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: "open"
            });
            const existing = issues.find((issue) => issue.body && issue.body.includes(marker));
            const issuePayload = {
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              labels,
              body
            };
            try {
              if (existing) {
                await github.rest.issues.update({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: existing.number,
                  body
                });
              } else {
                await github.rest.issues.create(issuePayload);
              }
            } catch (error) {
              core.warning("Issue create/update with labels failed, retrying without labels: " + redactSecretValues(error.message));
              if (existing) {
                await github.rest.issues.update({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: existing.number,
                  body
                });
              } else {
                await github.rest.issues.create({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  title,
                  body
                });
              }
            }
      - name: Future trusted Hive Bead API adapter
        run: |
          echo "Future insertion point for a governed Hive Bead API call."
          echo "Keep disabled until endpoint, token env, approval, and retry policy are configured."
`;

export const scheduledWorkflowTemplate = `name: Visual Hive Scheduled

on:
  schedule:
    - cron: "0 */4 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  visual-hive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - uses: DavidDiaz0317/visual-hive/actions/run@main
        with:
          command: pipeline
          arguments: --mode schedule --ci --enforce-mutation --github-step-summary
      # This scheduled workflow may use protected secrets. A separate trusted
      # workflow_run workflow can create issues from .visual-hive/issues.json.
      # For stricter supply-chain hardening, pin actions by SHA instead of tags.
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`;

export const githubWorkflowTemplates: GitHubWorkflowTemplate[] = [
  {
    id: "pull_request",
    label: "Visual Hive PR",
    path: ".github/workflows/visual-hive-pr.yml",
    description: "Read-only, no-secret PR validation for PR-safe deterministic contracts.",
    safetyNotes: ["Uses pull_request, not pull_request_target.", "Uses contents: read only.", "Uploads .visual-hive artifacts for trusted follow-up."],
    content: prWorkflowTemplate
  },
  {
    id: "scheduled",
    label: "Visual Hive Scheduled",
    path: ".github/workflows/visual-hive-scheduled.yml",
    description: "Scheduled or manually dispatched deeper validation, including mutation adequacy and protected lanes when configured.",
    safetyNotes: ["Can be bound to protected environments/secrets.", "Uploads .visual-hive artifacts.", "Runs mutation score enforcement separately from PR checks."],
    content: scheduledWorkflowTemplate
  },
  {
    id: "trusted_failure_issue",
    label: "Visual Hive Failure Issue",
    path: ".github/workflows/visual-hive-failure-issue.yml",
    description: "Trusted workflow_run consumer that creates or updates issues from sanitized uploaded artifacts without checking out PR code.",
    safetyNotes: [
      "Does not checkout or execute PR code.",
      "Recursively discovers uploaded issues.json artifacts.",
      "Redacts secret-like values again before issue creation.",
      "Dedupes by stable deterministic failure signature."
    ],
    content: failureIssueWorkflowTemplate
  },
  {
    id: "trusted_hive_handoff",
    label: "Visual Hive Hive Handoff",
    path: ".github/workflows/visual-hive-hive-handoff.yml",
    description: "Trusted workflow_run consumer that validates sanitized Evidence/Handoff/Hive dry-run artifacts without checking out PR code or calling Hive by default.",
    safetyNotes: [
      "Does not checkout or execute PR code.",
      "Consumes uploaded .visual-hive artifacts only.",
      "Requires dry-run Hive artifacts with externalCallsMade: 0.",
      "Leaves the real Hive Bead API call as a trusted, policy-gated future insertion point."
    ],
    content: hiveHandoffWorkflowTemplate
  }
];
