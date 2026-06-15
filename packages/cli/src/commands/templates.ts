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

ai:
  enabled: false
  provider: none
  neverSoleOracle: true
  createIssuePrompt: true
  maxDailyRuns: 5

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
            const path = "visual-hive-artifacts/issue.md";
            const body = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "Visual Hive failed, but no issue.md artifact was found.";
            const marker = "<!-- visual-hive-dedupe:" + context.payload.workflow_run.id + " -->";
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
