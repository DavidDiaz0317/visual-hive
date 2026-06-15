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
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-hive
          path: .visual-hive
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
      # A trusted follow-up workflow can create issues from .visual-hive/issue.md.
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-hive
          path: .visual-hive
`;
