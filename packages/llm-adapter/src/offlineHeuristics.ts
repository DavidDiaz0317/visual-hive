import type { TriageFinding } from "@visual-hive/core";
import type { TriageInput } from "./types.js";

export function classifyOffline(input: TriageInput): TriageFinding[] {
  const findings: TriageFinding[] = [];
  const failures = input.report?.results.filter((result) => result.status === "failed") ?? [];

  for (const failure of failures) {
    const evidence = failure.errors;
    const joined = evidence.join("\n").toLowerCase();
    if ((failure.pageErrors?.length ?? 0) > 0 || joined.includes("page error")) {
      findings.push(finding("page_error", "high", `Unexpected page error in ${failure.contractId}`, evidence));
    } else if ((failure.consoleErrors?.length ?? 0) > 0 || joined.includes("console")) {
      findings.push(finding("console_error", "high", `Unexpected console error in ${failure.contractId}`, evidence));
    } else if (joined.includes("target server failed") || joined.includes("failed to start")) {
      findings.push(finding("target_startup_failure", "critical", `Target startup failed for ${failure.contractId}`, evidence));
    } else if (joined.includes("missing screenshot baseline") || joined.includes("missing baseline")) {
      findings.push(finding("missing_baseline", "medium", `Missing visual baseline for ${failure.contractId}`, evidence));
    } else if (joined.includes("login") || failure.contractId.includes("login")) {
      findings.push(finding("login_regression", "critical", `Login state regression in ${failure.contractId}`, evidence));
    } else if (joined.includes("api") || joined.includes("500") || joined.includes("response")) {
      findings.push(finding("api_contract_regression", "high", `API contract regression in ${failure.contractId}`, evidence));
    } else if (joined.includes("absent") || joined.includes("mustnotexist")) {
      findings.push(finding("unexpected_element", "high", `Unexpected element in ${failure.contractId}`, evidence));
    } else if (joined.includes("locator") || joined.includes("mustexist") || joined.includes("expected")) {
      findings.push(finding("missing_element", "high", `Missing element in ${failure.contractId}`, evidence));
    } else if (joined.includes("screenshot") || joined.includes("snapshot") || joined.includes("baseline") || joined.includes("diff")) {
      findings.push(finding("visual_diff", "medium", `Visual snapshot difference in ${failure.contractId}`, evidence));
    } else if (joined.includes("timeout") || joined.includes("navigation")) {
      findings.push(finding("possible_flake", "medium", `Possible timing or navigation flake in ${failure.contractId}`, evidence));
    } else {
      findings.push(finding("environment_failure", "medium", `Execution failure in ${failure.contractId}`, evidence));
    }
  }

  const createdBaselines =
    input.report?.results.flatMap((result) => result.screenshotAssertions ?? []).filter((screenshot) => screenshot.status === "created") ?? [];
  for (const screenshot of createdBaselines) {
    findings.push({
      classification: "created_baseline",
      severity: "low",
      title: `Created visual baseline: ${screenshot.name}`,
      evidence: [`Baseline path: ${screenshot.baselinePath}`],
      suggestedNextTests: ["Review the created baseline before relying on CI-mode visual comparisons."]
    });
  }

  const flakyBaselineCandidates =
    input.report?.results
      .flatMap((result) => result.screenshotAssertions ?? [])
      .filter((screenshot) => screenshot.status === "failed" && isSmallVisualDiff(screenshot.actualDiffPixelRatio, screenshot.maxDiffPixelRatio)) ?? [];
  for (const screenshot of flakyBaselineCandidates) {
    findings.push({
      classification: "flaky_baseline",
      severity: "medium",
      title: `Small visual diff near threshold: ${screenshot.contractId}/${screenshot.screenshotName}`,
      evidence: [
        `Diff ratio: ${screenshot.actualDiffPixelRatio ?? "unknown"}`,
        `Threshold: ${screenshot.maxDiffPixelRatio}`,
        `Actual path: ${screenshot.actualPath}`,
        screenshot.diffPath ? `Diff path: ${screenshot.diffPath}` : "No diff artifact path was reported."
      ],
      suggestedNextTests: [
        "Review the diff image before changing thresholds.",
        "Mask dynamic regions or stabilize fixture data if the diff is nondeterministic."
      ]
    });
  }

  const providerFailures =
    input.report?.providerResults?.filter((provider) => provider.status === "failed" || provider.status === "missing_credentials") ?? [];
  for (const provider of providerFailures) {
    findings.push({
      classification: "provider_failure",
      severity: provider.status === "failed" ? "high" : "medium",
      title: `Provider ${provider.label} reported ${provider.status}`,
      evidence: [
        provider.message,
        provider.missingEnv.length ? `Missing env names: ${provider.missingEnv.join(", ")}` : "No missing env names reported.",
        `Deterministic role: ${provider.deterministicRole}`
      ],
      suggestedNextTests: [
        "Keep Playwright deterministic contracts as the pass/fail oracle.",
        "Configure optional provider credentials only in trusted workflows if this provider is required."
      ]
    });
  }

  const protectedTargets = input.report?.selectedTargets.filter((target) => target.missingSecrets?.length) ?? [];
  for (const target of protectedTargets) {
    findings.push({
      classification: "protected_target_missing_secret",
      severity: "high",
      title: `Protected target ${target.id} is missing required secret names`,
      evidence: [`Missing env names: ${target.missingSecrets?.join(", ")}`],
      suggestedNextTests: [
        "Run protected target checks only from scheduled or manual trusted workflows.",
        "Configure the missing environment variables without exposing their values in PR logs."
      ]
    });
  }

  const coverageGaps = input.coverageReport?.uncoveredAreas ?? [];
  for (const gap of coverageGaps.slice(0, 8)) {
    findings.push({
      classification: "insufficient_coverage",
      severity: gap.severity,
      title: `Coverage gap: ${gap.kind}`,
      evidence: [
        gap.message,
        gap.targetId ? `Target: ${gap.targetId}` : "",
        gap.contractId ? `Contract: ${gap.contractId}` : "",
        gap.route ? `Route: ${gap.route}` : "",
        gap.changedFile ? `Changed file: ${gap.changedFile}` : ""
      ].filter(Boolean),
      suggestedNextTests: coverageSuggestionFor(gap.kind)
    });
  }

  const survived = input.mutationReport?.results.filter((result) => result.status === "survived") ?? [];
  for (const result of survived) {
    findings.push({
      classification: "mutation_survivor",
      severity: "high",
      title: `Mutation survived: ${result.operator}`,
      evidence: result.errors.length ? result.errors : [`Operator ${result.operator} did not fail any selected contract.`],
      suggestedNextTests: [`Add an assertion that detects ${result.operator}.`, "Review whether the selected contracts cover the changed UI state."]
    });
  }

  if (failures.length === 0 && survived.length === 0 && input.report && input.report.results.length === 0) {
    findings.push({
      classification: "no_contracts_selected",
      severity: "medium",
      title: "No contracts were executed",
      evidence: ["The deterministic report contains no contract results."],
      suggestedNextTests: ["Add at least one route screenshot and one selector contract for the main user-visible page."]
    });
  }

  return findings;
}

function isSmallVisualDiff(actual: number | undefined, threshold: number): boolean {
  if (actual === undefined || threshold <= 0) return false;
  return actual > threshold && actual <= threshold * 1.5;
}

function coverageSuggestionFor(kind: string): string[] {
  if (kind === "target_without_contracts") {
    return ["Add at least one selector contract and one screenshot contract for this target."];
  }
  if (kind === "contract_without_assertions") {
    return ["Add mustExist/mustNotExist selectors or route screenshots to make the contract enforce a user-visible state."];
  }
  if (kind === "route_without_pr_safe_coverage") {
    return ["Add a PR-safe screenshot contract for this route or explain why it must remain schedule-only."];
  }
  if (kind === "viewport_without_screenshots") {
    return ["Add a screenshot for this viewport, especially mobile routes likely to regress visually."];
  }
  if (kind === "changed_file_without_rule") {
    return ["Add a changed-file selection rule so this code path selects the right deterministic contracts."];
  }
  return ["Review coverage and add the smallest deterministic contract that protects the uncovered user-visible behavior."];
}

function finding(
  classification: TriageFinding["classification"],
  severity: TriageFinding["severity"],
  title: string,
  evidence: string[]
): TriageFinding {
  return {
    classification,
    severity,
    title,
    evidence,
    suggestedNextTests: [
      "Add a selector contract around the failing user-visible state.",
      "Add a screenshot contract for the smallest route that reproduces the issue."
    ]
  };
}
