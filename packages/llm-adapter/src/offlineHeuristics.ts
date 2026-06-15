import type { TriageFinding } from "@visual-hive/core";
import type { TriageInput } from "./types.js";

export function classifyOffline(input: TriageInput): TriageFinding[] {
  const findings: TriageFinding[] = [];
  const failures = input.report?.results.filter((result) => result.status === "failed") ?? [];

  for (const failure of failures) {
    const evidence = failure.errors;
    const joined = evidence.join("\n").toLowerCase();
    if (joined.includes("login") || failure.contractId.includes("login")) {
      findings.push(finding("login_regression", "critical", `Login state regression in ${failure.contractId}`, evidence));
    } else if (joined.includes("api") || joined.includes("500") || joined.includes("response")) {
      findings.push(finding("api_contract_regression", "high", `API contract regression in ${failure.contractId}`, evidence));
    } else if (joined.includes("locator") || joined.includes("mustexist") || joined.includes("expected")) {
      findings.push(finding("missing_element", "high", `Missing or unexpected element in ${failure.contractId}`, evidence));
    } else if (joined.includes("screenshot") || joined.includes("snapshot") || joined.includes("baseline")) {
      findings.push(finding("visual_diff", "medium", `Visual snapshot difference in ${failure.contractId}`, evidence));
    } else if (joined.includes("timeout") || joined.includes("navigation")) {
      findings.push(finding("possible_flake", "medium", `Possible timing or navigation flake in ${failure.contractId}`, evidence));
    } else {
      findings.push(finding("environment_failure", "medium", `Execution failure in ${failure.contractId}`, evidence));
    }
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
      classification: "coverage_gap",
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
