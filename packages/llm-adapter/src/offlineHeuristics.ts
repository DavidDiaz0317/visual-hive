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

  const survived = input.mutationReport?.results.filter((result) => !result.killed) ?? [];
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
