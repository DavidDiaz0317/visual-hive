import type { TriageFinding } from "@visual-hive/core";
import type { TriageInput } from "./types.js";

export function classifyOffline(input: TriageInput): TriageFinding[] {
  const findings: TriageFinding[] = [];
  const failures = input.report?.results.filter((result) => result.status === "failed") ?? [];
  const changedFiles = input.report?.changedFiles ?? [];

  for (const failure of failures) {
    const evidence = failure.errors;
    const joined = evidence.join("\n").toLowerCase();
    const context = { contractIds: [failure.contractId], targetIds: [failure.targetId], suggestedFiles: changedFiles };
    if ((failure.pageErrors?.length ?? 0) > 0 || joined.includes("page error")) {
      findings.push(finding("page_error", "high", `Unexpected page error in ${failure.contractId}`, evidence, context));
    } else if ((failure.consoleErrors?.length ?? 0) > 0 || joined.includes("console")) {
      findings.push(finding("console_error", "high", `Unexpected console error in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("target server failed") || joined.includes("failed to start")) {
      findings.push(finding("target_startup_failure", "critical", `Target startup failed for ${failure.contractId}`, evidence, context));
    } else if (joined.includes("missing screenshot baseline") || joined.includes("missing baseline")) {
      findings.push(finding("missing_baseline", "medium", `Missing visual baseline for ${failure.contractId}`, evidence, context));
    } else if (joined.includes("login") || failure.contractId.includes("login")) {
      findings.push(finding("login_regression", "critical", `Login state regression in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("api") || joined.includes("500") || joined.includes("response")) {
      findings.push(finding("api_contract_regression", "high", `API contract regression in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("absent") || joined.includes("mustnotexist")) {
      findings.push(finding("unexpected_element", "high", `Unexpected element in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("locator") || joined.includes("mustexist") || joined.includes("expected")) {
      findings.push(finding("missing_element", "high", `Missing element in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("screenshot") || joined.includes("snapshot") || joined.includes("baseline") || joined.includes("diff")) {
      findings.push(finding("visual_diff", "medium", `Visual snapshot difference in ${failure.contractId}`, evidence, context));
    } else if (joined.includes("timeout") || joined.includes("navigation")) {
      findings.push(finding("possible_flake", "medium", `Possible timing or navigation flake in ${failure.contractId}`, evidence, context));
    } else {
      findings.push(finding("environment_failure", "medium", `Execution failure in ${failure.contractId}`, evidence, context));
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
      contractIds: [screenshot.contractId],
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
      contractIds: [screenshot.contractId],
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
      suggestedFiles: changedFiles,
      suggestedNextTests: [
        "Keep Visual Hive verdict artifacts as the pass/fail authority.",
        "Configure optional provider credentials only in trusted workflows if this provider is required."
      ]
    });
  }

  const policyBlockedProviders =
    input.report?.providerResults?.filter((provider) => provider.externalUploadAllowed === false && provider.externalUploadBlockedReasons?.length) ?? [];
  for (const provider of policyBlockedProviders) {
    const blockedReasons = provider.externalUploadBlockedReasons ?? [];
    findings.push({
      classification: provider.status === "skipped" ? "provider_cost_policy_skipped" : "external_upload_blocked",
      severity: "low",
      title: `Provider ${provider.label} external upload is blocked by policy`,
      evidence: [
        provider.message,
        ...blockedReasons,
        `Estimated external screenshots: ${provider.estimatedExternalScreenshots ?? 0}`
      ],
      suggestedFiles: changedFiles,
      suggestedNextTests: [
        "Keep the default no-external-upload policy for PRs unless a trusted workflow explicitly opts in.",
        "If hosted review is needed, raise costPolicy.maxExternalScreenshotsPerRun and enable the intended run mode only."
      ]
    });
  }

  const providerRunProviders = input.providerRunReport?.providers ?? [];
  for (const provider of providerRunProviders) {
    const failedOperations = provider.operations.filter((operation) => operation.status === "failed");
    const upload = provider.result.upload;
    if (provider.result.status === "failed" || provider.result.status === "missing_credentials" || failedOperations.length > 0) {
      findings.push({
        classification: "provider_failure",
        severity: provider.result.status === "failed" || failedOperations.length > 0 ? "high" : "medium",
        title: `Provider adapter attention needed: ${provider.label}`,
        evidence: [
          provider.result.message,
          provider.missingEnv.length ? `Missing env names: ${provider.missingEnv.join(", ")}` : "No missing env names reported.",
          failedOperations.length
            ? `Failed operations: ${failedOperations.map((operation) => `${operation.operation}:${operation.message}`).join("; ")}`
            : "No failed adapter operation was reported.",
          `Network mode: ${provider.normalized.networkMode}`,
          `External calls made: ${provider.normalized.externalCallsMade}`,
          upload ? `Upload status: ${upload.status}` : "",
          upload?.command ? `Upload command: ${upload.command}` : "",
          upload?.stderr ? `Upload stderr: ${upload.stderr}` : "",
          upload?.stdout ? `Upload stdout: ${upload.stdout}` : ""
        ].filter(Boolean),
        suggestedFiles: changedFiles,
        suggestedNextTests: [
          "Keep Visual Hive verdict artifacts as the pass/fail authority.",
          "If this optional provider is required, configure credential names only in trusted workflows and rerun provider mock validation."
        ]
      });
    }
    const blockedReasons = provider.normalized.costPolicy.blockedReasons;
    if (blockedReasons.length > 0 || provider.normalized.networkMode === "policy_blocked") {
      findings.push({
        classification: provider.result.status === "skipped" ? "provider_cost_policy_skipped" : "external_upload_blocked",
        severity: "low",
        title: `Provider adapter upload blocked: ${provider.label}`,
        evidence: [
          provider.result.message,
          ...blockedReasons,
          `Upload mode: ${provider.normalized.artifactSummary.uploadMode}`,
          `Estimated external screenshots: ${provider.normalized.costPolicy.estimatedExternalScreenshots}`
        ],
        suggestedFiles: changedFiles,
        suggestedNextTests: [
          "Keep provider uploads disabled on PRs unless a trusted workflow explicitly opts in.",
          "Review costPolicy before enabling external artifact upload."
        ]
      });
    }
  }

  const protectedTargets = input.report?.selectedTargets.filter((target) => target.missingSecrets?.length) ?? [];
  for (const target of protectedTargets) {
    findings.push({
      classification: "protected_target_missing_secret",
      severity: "high",
      title: `Protected target ${target.id} is missing required secret names`,
      evidence: [`Missing env names: ${target.missingSecrets?.join(", ")}`],
      targetIds: [target.id],
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
      contractIds: gap.contractId ? [gap.contractId] : undefined,
      targetIds: gap.targetId ? [gap.targetId] : undefined,
      suggestedFiles: gap.changedFile ? [gap.changedFile] : changedFiles,
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
      contractIds: result.contractIds,
      suggestedNextTests: [`Add an assertion that detects ${result.operator}.`, "Review whether the selected contracts cover the changed UI state."]
    });
  }

  if (failures.length === 0 && survived.length === 0 && input.report && input.report.results.length === 0) {
    findings.push({
      classification: "no_contracts_selected",
      severity: "medium",
      title: "No contracts were executed",
      evidence: ["The deterministic report contains no contract results."],
      suggestedFiles: changedFiles,
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
  evidence: string[],
  context: Pick<TriageFinding, "contractIds" | "targetIds" | "suggestedFiles"> = {}
): TriageFinding {
  return {
    classification,
    severity,
    title,
    evidence,
    ...context,
    suggestedNextTests: [
      "Add a selector contract around the failing user-visible state.",
      "Add a screenshot contract for the smallest route that reproduces the issue."
    ]
  };
}
