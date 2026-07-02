import type { VisualHiveConfig } from "../config/schema.js";
import type { WorkflowAuditReport } from "../github/workflowAudit.js";
import { sanitizeText } from "../utils/sanitize.js";

export type SecurityFindingSeverity = "low" | "medium" | "high" | "critical";
export type SecurityFindingCategory =
  | "workflow"
  | "secrets"
  | "protected_target"
  | "provider"
  | "llm"
  | "dependency"
  | "artifact"
  | "policy";

export interface NpmAuditSummary {
  source: "not_run" | "npm_audit_json" | "npm_audit_command";
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  error?: string;
}

export interface SecurityAuditFinding {
  id: string;
  category: SecurityFindingCategory;
  severity: SecurityFindingSeverity;
  title: string;
  message: string;
  evidence: string[];
  recommendation: string;
  trustedOnly: boolean;
}

export interface SecurityAuditReport {
  schemaVersion: 1;
  project: string;
  generatedAt: string;
  summary: {
    score: number;
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    prBlocking: number;
    trustedOnly: number;
    npmAuditSource: NpmAuditSummary["source"];
    npmAuditTotal: number;
  };
  inputs: {
    workflowAudit: boolean;
    npmAudit: boolean;
  };
  npmAudit: NpmAuditSummary;
  findings: SecurityAuditFinding[];
  recommendations: string[];
}

export interface AnalyzeSecurityOptions {
  workflowAudit?: WorkflowAuditReport;
  npmAudit?: NpmAuditSummary;
  now?: Date;
}

const emptyNpmAudit: NpmAuditSummary = {
  source: "not_run",
  total: 0,
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0
};

export function analyzeSecurity(config: VisualHiveConfig, options: AnalyzeSecurityOptions = {}): SecurityAuditReport {
  const npmAudit = options.npmAudit ?? emptyNpmAudit;
  const findings = [
    ...workflowFindings(options.workflowAudit),
    ...protectedTargetFindings(config),
    ...providerFindings(config),
    ...llmFindings(config),
    ...npmAuditFindings(npmAudit)
  ]
    .map(sanitizeFinding)
    .sort(compareFindings);
  const summary = summarize(findings, npmAudit);
  return {
    schemaVersion: 1,
    project: config.project.name,
    generatedAt: (options.now ?? new Date()).toISOString(),
    summary,
    inputs: {
      workflowAudit: Boolean(options.workflowAudit),
      npmAudit: npmAudit.source !== "not_run"
    },
    npmAudit,
    findings,
    recommendations: recommendations(findings, npmAudit)
  };
}

export function npmAuditSummaryFromJson(value: unknown, source: NpmAuditSummary["source"] = "npm_audit_json"): NpmAuditSummary {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const metadata = root.metadata && typeof root.metadata === "object" ? (root.metadata as Record<string, unknown>) : {};
  const vulnerabilities =
    metadata.vulnerabilities && typeof metadata.vulnerabilities === "object"
      ? (metadata.vulnerabilities as Record<string, unknown>)
      : root.vulnerabilities && typeof root.vulnerabilities === "object"
        ? countVulnerabilityObject(root.vulnerabilities as Record<string, unknown>)
        : {};
  const critical = numberField(vulnerabilities, "critical");
  const high = numberField(vulnerabilities, "high");
  const moderate = numberField(vulnerabilities, "moderate");
  const low = numberField(vulnerabilities, "low");
  const info = numberField(vulnerabilities, "info");
  const total = numberField(vulnerabilities, "total") || critical + high + moderate + low + info;
  return {
    source,
    total,
    critical,
    high,
    moderate,
    low,
    info
  };
}

export function npmAuditSummaryFromError(error: unknown, source: NpmAuditSummary["source"] = "npm_audit_command"): NpmAuditSummary {
  return {
    ...emptyNpmAudit,
    source,
    error: sanitizeText(error instanceof Error ? error.message : String(error))
  };
}

function workflowFindings(workflowAudit?: WorkflowAuditReport): SecurityAuditFinding[] {
  if (!workflowAudit) {
    return [
      {
        id: "workflow:audit-missing",
        category: "workflow",
        severity: "medium",
        title: "Workflow safety audit is missing",
        message: "No workflow audit was available, so PR and trusted workflow safety could not be verified.",
        evidence: [".visual-hive/workflows.json not found"],
        recommendation: "Run visual-hive workflows before relying on GitHub automation.",
        trustedOnly: false
      }
    ];
  }
  return workflowAudit.findings.map((finding) => ({
    id: `workflow:${finding.kind}:${finding.workflowPath}`,
    category: "workflow",
    severity: finding.severity,
    title: `Workflow safety finding: ${finding.kind}`,
    message: finding.message,
    evidence: [finding.workflowPath, finding.evidence],
    recommendation: workflowRecommendation(finding.kind),
    trustedOnly: finding.workflowPath.includes("issue") || finding.workflowPath.includes("trusted")
  }));
}

function protectedTargetFindings(config: VisualHiveConfig): SecurityAuditFinding[] {
  return Object.entries(config.targets).flatMap(([targetId, target]) => {
    if (target.kind !== "protected") return [];
    const findings: SecurityAuditFinding[] = [];
    if (target.prSafe) {
      findings.push({
        id: `protected-target:${targetId}:pr-safe`,
        category: "protected_target",
        severity: "critical",
        title: `Protected target marked PR-safe: ${targetId}`,
        message: "Protected targets must not run from untrusted pull_request code by default.",
        evidence: [`target=${targetId}`, "prSafe=true"],
        recommendation: "Set prSafe: false and run this target only from trusted scheduled/manual workflows.",
        trustedOnly: true
      });
    }
    if ((target.requiresSecrets ?? []).length === 0) {
      findings.push({
        id: `protected-target:${targetId}:no-secret-names`,
        category: "protected_target",
        severity: "medium",
        title: `Protected target has no required secret names: ${targetId}`,
        message: "Protected targets should list required environment variable names so doctor/report output can explain trusted-lane readiness without printing values.",
        evidence: [`target=${targetId}`],
        recommendation: "Add requiresSecrets with secret names only, such as KUBECONFIG or service tokens.",
        trustedOnly: true
      });
    }
    return findings;
  });
}

function providerFindings(config: VisualHiveConfig): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const externalProviderEnabled = Object.entries(config.providers).filter(
    ([providerId, provider]) => providerId !== "playwright" && provider.enabled && provider.mode === "external"
  );
  if (externalProviderEnabled.length && config.costPolicy.externalUpload.pullRequest) {
    findings.push({
      id: "provider:external-upload-pr",
      category: "provider",
      severity: "high",
      title: "External provider upload is allowed on PRs",
      message: "External screenshot upload from untrusted PR code can expose artifacts or consume paid quota.",
      evidence: externalProviderEnabled.map(([providerId]) => providerId),
      recommendation: "Keep costPolicy.externalUpload.pullRequest=false unless a trusted, no-secret upload path is explicitly reviewed.",
      trustedOnly: true
    });
  }
  for (const [providerId, provider] of externalProviderEnabled) {
    findings.push({
      id: `provider:${providerId}:external-enabled`,
      category: "provider",
      severity: provider.requiredEnv.length ? "medium" : "low",
      title: `External provider enabled: ${providerId}`,
      message: "External providers are supplemental and should run only when credentials, cost policy, and trusted workflow boundaries are reviewed.",
      evidence: [`provider=${providerId}`, `requiredEnv=${provider.requiredEnv.join(",") || "none"}`],
      recommendation: "Prefer mock mode until a trusted provider setup review approves external calls and billing impact.",
      trustedOnly: true
    });
  }
  return findings;
}

function llmFindings(config: VisualHiveConfig): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  if (config.ai.enabled) {
    findings.push({
      id: "llm:enabled",
      category: "llm",
      severity: config.ai.provider === "none" ? "low" : "medium",
      title: "LLM usage is enabled in config",
      message: "LLM output must remain advisory and should run only under explicit governance.",
      evidence: [`provider=${config.ai.provider}`, `model=${config.ai.model}`, `maxEstimatedCostUsd=${config.ai.maxEstimatedCostUsd}`],
      recommendation: "Keep LLM usage prompt-only unless a trusted workflow explicitly performs governed model calls.",
      trustedOnly: config.ai.provider !== "none"
    });
  }
  if (config.ai.maxEstimatedCostUsd > 0 && config.ai.provider !== "none") {
    findings.push({
      id: "llm:cost-budget-enabled",
      category: "llm",
      severity: "low",
      title: "LLM cost budget is nonzero",
      message: "A nonzero model budget should be paired with an explicit trusted workflow and usage review.",
      evidence: [`maxEstimatedCostUsd=${config.ai.maxEstimatedCostUsd}`],
      recommendation: "Record an LLM governance decision and keep Visual Hive deterministic verdict artifacts as the pass/fail authority.",
      trustedOnly: true
    });
  }
  return findings;
}

function npmAuditFindings(npmAudit: NpmAuditSummary): SecurityAuditFinding[] {
  if (npmAudit.source === "not_run") {
    return [
      {
        id: "dependency:npm-audit-not-run",
        category: "dependency",
        severity: "low",
        title: "Dependency audit was not run",
        message: "Security audit did not run npm audit by default, preserving local/offline determinism.",
        evidence: ["npmAudit.source=not_run"],
        recommendation: "Run visual-hive security --npm-audit in a trusted environment or pass --audit-json from an existing npm audit artifact.",
        trustedOnly: false
      }
    ];
  }
  if (npmAudit.error) {
    return [
      {
        id: "dependency:npm-audit-error",
        category: "dependency",
        severity: "medium",
        title: "Dependency audit failed",
        message: "npm audit could not produce a usable result.",
        evidence: [npmAudit.error],
        recommendation: "Run npm audit manually and pass the JSON result with visual-hive security --audit-json.",
        trustedOnly: false
      }
    ];
  }
  const findings: SecurityAuditFinding[] = [];
  if (npmAudit.critical > 0) {
    findings.push(dependencyFinding("critical", "critical", npmAudit.critical));
  }
  if (npmAudit.high > 0) {
    findings.push(dependencyFinding("high", "high", npmAudit.high));
  }
  if (npmAudit.moderate > 0) {
    findings.push(dependencyFinding("moderate", "medium", npmAudit.moderate));
  }
  return findings;
}

function dependencyFinding(kind: "critical" | "high" | "moderate", severity: SecurityFindingSeverity, count: number): SecurityAuditFinding {
  return {
    id: `dependency:npm-audit-${kind}`,
    category: "dependency",
    severity,
    title: `npm audit reported ${count} ${kind} vulnerabilit${count === 1 ? "y" : "ies"}`,
    message: "Dependency risk is present in the current package tree.",
    evidence: [`${kind}=${count}`],
    recommendation: "Review npm audit details and upgrade dependencies deliberately; do not use force fixes without checking breaking changes.",
    trustedOnly: false
  };
}

function workflowRecommendation(kind: string): string {
  if (kind.includes("pull_request_target")) return "Replace pull_request_target with pull_request for workflows that execute PR code.";
  if (kind.includes("secrets")) return "Keep PR workflows secret-free; move secret-bearing checks to scheduled/manual trusted lanes.";
  if (kind.includes("write_permissions")) return "Use contents: read on PR workflows.";
  if (kind.includes("artifact")) return "Upload .visual-hive artifacts with include-hidden-files: true.";
  if (kind.includes("action_not_sha_pinned")) return "Pin external GitHub Actions by full commit SHA for production hardening.";
  if (kind.includes("issue")) return "Create issues only from trusted workflow_run consumers of sanitized artifacts.";
  return "Review the workflow safety finding and apply least-privilege permissions.";
}

function summarize(findings: SecurityAuditFinding[], npmAudit: NpmAuditSummary): SecurityAuditReport["summary"] {
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const low = findings.filter((finding) => finding.severity === "low").length;
  const score = Math.max(0, 100 - critical * 30 - high * 15 - medium * 7 - low * 2);
  return {
    score,
    totalFindings: findings.length,
    critical,
    high,
    medium,
    low,
    prBlocking: findings.filter((finding) => !finding.trustedOnly && (finding.severity === "critical" || finding.severity === "high")).length,
    trustedOnly: findings.filter((finding) => finding.trustedOnly).length,
    npmAuditSource: npmAudit.source,
    npmAuditTotal: npmAudit.total
  };
}

function recommendations(findings: SecurityAuditFinding[], npmAudit: NpmAuditSummary): string[] {
  if (!findings.length) return ["No immediate Visual Hive security posture findings were detected."];
  const recs = new Set<string>();
  const workflowFindings = findings.filter((finding) => finding.category === "workflow");
  if (workflowFindings.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
    recs.add("Fix critical/high workflow safety findings before making Visual Hive checks required.");
  }
  if (workflowFindings.some((finding) => finding.id.includes("action_not_sha_pinned"))) {
    recs.add("For production hardening, pin external GitHub Actions by full commit SHA after reviewing upstream source.");
  }
  if (workflowFindings.some((finding) => finding.severity === "medium")) {
    recs.add("Review medium-severity workflow safety findings before expanding Visual Hive automation.");
  }
  if (findings.some((finding) => finding.category === "protected_target")) recs.add("Keep protected targets out of PR workflows and list required secret names only.");
  if (findings.some((finding) => finding.category === "provider")) recs.add("Keep external provider uploads disabled on PRs unless explicitly reviewed.");
  if (findings.some((finding) => finding.category === "llm")) recs.add("Keep LLM usage prompt-only and advisory unless a trusted workflow is explicitly approved.");
  if (npmAudit.source === "not_run") recs.add("Run npm audit in a trusted environment and feed the JSON into visual-hive security when reviewing supply-chain risk.");
  if (findings.some((finding) => finding.category === "dependency" && finding.severity !== "low")) recs.add("Review dependency vulnerabilities and upgrade without force-applying breaking changes.");
  return [...recs];
}

function sanitizeFinding(finding: SecurityAuditFinding): SecurityAuditFinding {
  return {
    ...finding,
    id: sanitizeText(finding.id),
    title: sanitizeText(finding.title),
    message: sanitizeText(finding.message),
    evidence: finding.evidence.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 10),
    recommendation: sanitizeText(finding.recommendation)
  };
}

function compareFindings(a: SecurityAuditFinding, b: SecurityAuditFinding): number {
  return severityWeight(b.severity) - severityWeight(a.severity) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);
}

function severityWeight(severity: SecurityFindingSeverity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function countVulnerabilityObject(vulnerabilities: Record<string, unknown>): Record<string, number> {
  const counts = { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const vulnerability of Object.values(vulnerabilities)) {
    if (!vulnerability || typeof vulnerability !== "object") continue;
    const severity = String((vulnerability as Record<string, unknown>).severity ?? "");
    if (severity in counts) {
      counts[severity as keyof typeof counts] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
