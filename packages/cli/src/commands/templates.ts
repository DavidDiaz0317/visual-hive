import { failureIssueWorkflowTemplate, hiveHandoffWorkflowTemplate, prWorkflowTemplate, scheduledWorkflowTemplate } from "@visual-hive/core";

export { failureIssueWorkflowTemplate, hiveHandoffWorkflowTemplate, prWorkflowTemplate, scheduledWorkflowTemplate };

export const defaultConfigTemplate = `project:
  name: visual-hive-target
  type: react-vite
  defaultBranch: main

targets:
  localPreview:
    kind: command
    install: "npm ci"
    build: "npm run build"
    serve: "npm run preview -- --port 4173 --strictPort"
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
