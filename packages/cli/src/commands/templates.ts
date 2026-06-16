export const defaultConfigTemplate = `project:
  name: visual-hive-target
  type: react-vite
  defaultBranch: main

targets:
  localPreview:
    kind: command
    install: "npm ci"
    build: "npm run build"
    serve: "npm run preview -- --port 4173"
    url: "http://127.0.0.1:4173"
    prSafe: true
    cost: cheap

contracts:
  - id: dashboard-visual-stability
    description: Dashboard should render stable visual layout.
    target: localPreview
    severity: high
    runOn:
      pullRequest: true
      schedule: true
    selectors:
      mustExist:
        - "[data-testid='dashboard-page']"
    screenshots:
      - name: dashboard-desktop
        route: "/"
        viewport: desktop
      - name: dashboard-mobile
        route: "/"
        viewport: mobile

viewports:
  desktop:
    width: 1440
    height: 900
  tablet:
    width: 768
    height: 1024
  mobile:
    width: 390
    height: 844

visual:
  maxDiffPixelRatio: 0.01
  updateSnapshots: false
  failOnMissingBaselineInCI: true
  snapshotDir: ".visual-hive/snapshots"
  artifactDir: ".visual-hive/artifacts"

selection:
  changedFiles:
    - pattern: "src/**"
      contracts:
        - dashboard-visual-stability
      risk: medium

mutation:
  enabled: true
  runOn:
    schedule: true
  minScore: 0.7
  operators:
    - hide-critical-button
    - force-login-on-demo
    - remove-demo-badge
    - api-500
    - empty-data
    - mobile-overflow
    - route-guard-bypass
    - hidden-error-banner
    - broken-image
    - removed-accessible-name
    - theme-token-drift
    - stale-loading-state

ai:
  enabled: false
  provider: none
  model: offline-heuristics
  neverSoleOracle: true
  createIssuePrompt: true
  maxDailyRuns: 5
  maxPromptTokens: 50000
  maxEstimatedCostUsd: 0

github:
  enabled: true
  issueLabels:
    - visual-hive
    - test-failure
  commentMarker: "<!-- visual-hive-report -->"
`;

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
      - run: npx visual-hive plan --mode pr --base origin/main --ci
      - run: npx visual-hive run --ci
      - run: npx visual-hive workflows
        if: always()
      - run: npx visual-hive triage
        if: always()
      - run: npx visual-hive report --github-step-summary
        if: always()
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
      # This trusted workflow does not checkout or execute PR code. For stricter
      # supply-chain hardening, pin third-party actions by SHA instead of tags.
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
      - run: npx visual-hive plan --mode schedule --ci
      - run: npx visual-hive run --ci
      - run: npx visual-hive mutate --enforce-min-score
      - run: npx visual-hive workflows
        if: always()
      - run: npx visual-hive triage
        if: always()
      - run: npx visual-hive report --github-step-summary
        if: always()
      # This scheduled workflow may use protected secrets. A separate trusted
      # workflow_run workflow can create issues from .visual-hive/issue.md.
      # For stricter supply-chain hardening, pin actions by SHA instead of tags.
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-hive
          path: .visual-hive
          include-hidden-files: true
`;
