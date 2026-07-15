import type {
  CapabilityDomain,
  CapabilityDomainSummary,
  CapabilityInventory,
  CapabilityParityCheck,
  CapabilityParityReport
} from "./types.js";

const DOMAINS: CapabilityDomain[] = [
  "cli",
  "schemas",
  "evidenceResources",
  "artifactSurfaces",
  "planModes",
  "workflowLanes",
  "mutationOperators",
  "deterministicPrimitives",
  "providers",
  "openSourceAdapters",
  "controlPlane"
];

const KEYS: Record<CapabilityDomain, (value: Record<string, unknown>) => string> = {
  cli: (value) => String(value.path),
  schemas: (value) => String(value.filename),
  evidenceResources: (value) => String(value.id),
  artifactSurfaces: (value) => String(value.path),
  planModes: (value) => String(value.mode),
  workflowLanes: (value) => String(value.id),
  mutationOperators: (value) => String(value.id),
  deterministicPrimitives: (value) => String(value.id),
  providers: (value) => String(value.id),
  openSourceAdapters: (value) => String(value.id),
  controlPlane: (value) => `${String(value.method)} ${String(value.path)}`
};

export function buildCapabilityParityReport(
  baseline: CapabilityInventory,
  actual: CapabilityInventory,
  now = new Date()
): CapabilityParityReport {
  const checks: CapabilityParityCheck[] = [];
  const domains: CapabilityDomainSummary[] = [];

  for (const domain of DOMAINS) {
    const expectedValues = records(baseline[domain]);
    const actualValues = records(actual[domain]);
    const domainChecks = compareDomain(domain, expectedValues, actualValues);
    checks.push(...domainChecks);
    domains.push(summarizeDomain(domain, expectedValues.length, actualValues.length, domainChecks));
  }

  const summary = summarizeChecks(domains);
  return {
    schemaVersion: "visual-hive.capability-parity.v1",
    baselineVersion: "visual-hive.capability-baseline.v1",
    generatedAt: now.toISOString(),
    status: summary.missing + summary.unexpected + summary.mismatched > 0 ? "failed" : "passed",
    runtimeStatus: summary.blocked > 0 ? "blocked" : "ready",
    summary,
    domains,
    checks
  };
}

function compareDomain(
  domain: CapabilityDomain,
  expectedValues: Array<Record<string, unknown>>,
  actualValues: Array<Record<string, unknown>>
): CapabilityParityCheck[] {
  const keyFor = KEYS[domain];
  const expected = indexValues(expectedValues, keyFor);
  const actual = indexValues(actualValues, keyFor);
  const checks: CapabilityParityCheck[] = [];

  for (const duplicate of [...expected.duplicates, ...actual.duplicates]) {
    checks.push({
      domain,
      key: duplicate,
      status: "mismatched",
      parity: false,
      message: `${domain} capability key ${duplicate} is duplicated.`
    });
  }

  for (const [key, expectedValue] of expected.values) {
    const actualValue = actual.values.get(key);
    if (!actualValue) {
      checks.push({
        domain,
        key,
        status: "missing",
        parity: false,
        message: `${domain} capability ${key} is missing from the current product surface.`,
        expected: expectedValue
      });
      continue;
    }
    if (stableJson(expectedValue) !== stableJson(actualValue)) {
      checks.push({
        domain,
        key,
        status: "mismatched",
        parity: false,
        message: `${domain} capability ${key} drifted from the frozen baseline.`,
        expected: expectedValue,
        actual: actualValue
      });
      continue;
    }
    const blocked = actualValue.runtimeStatus === "blocked";
    checks.push({
      domain,
      key,
      status: blocked ? "blocked" : "present",
      parity: true,
      message: blocked
        ? `${domain} capability ${key} is intentionally blocked: ${String(actualValue.blockedReason ?? "no blocked reason recorded")}`
        : `${domain} capability ${key} matches the frozen baseline.`,
      expected: expectedValue,
      actual: actualValue
    });
  }

  for (const [key, actualValue] of actual.values) {
    if (expected.values.has(key)) continue;
    checks.push({
      domain,
      key,
      status: "unexpected",
      parity: false,
      message: `${domain} capability ${key} is not reviewed in the frozen baseline.`,
      actual: actualValue
    });
  }

  return checks.sort((left, right) => left.key.localeCompare(right.key));
}

function indexValues(values: Array<Record<string, unknown>>, keyFor: (value: Record<string, unknown>) => string): {
  values: Map<string, Record<string, unknown>>;
  duplicates: string[];
} {
  const indexed = new Map<string, Record<string, unknown>>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (indexed.has(key)) duplicates.add(key);
    else indexed.set(key, value);
  }
  return { values: indexed, duplicates: [...duplicates].sort() };
}

function summarizeDomain(
  domain: CapabilityDomain,
  expected: number,
  actual: number,
  checks: CapabilityParityCheck[]
): CapabilityDomainSummary {
  return {
    domain,
    expected,
    actual,
    present: count(checks, "present"),
    blocked: count(checks, "blocked"),
    missing: count(checks, "missing"),
    unexpected: count(checks, "unexpected"),
    mismatched: count(checks, "mismatched")
  };
}

function summarizeChecks(domains: CapabilityDomainSummary[]): CapabilityParityReport["summary"] {
  return domains.reduce(
    (summary, domain) => ({
      expected: summary.expected + domain.expected,
      actual: summary.actual + domain.actual,
      present: summary.present + domain.present,
      blocked: summary.blocked + domain.blocked,
      missing: summary.missing + domain.missing,
      unexpected: summary.unexpected + domain.unexpected,
      mismatched: summary.mismatched + domain.mismatched
    }),
    { expected: 0, actual: 0, present: 0, blocked: 0, missing: 0, unexpected: 0, mismatched: 0 }
  );
}

function count(checks: CapabilityParityCheck[], status: CapabilityParityCheck["status"]): number {
  return checks.filter((check) => check.status === status).length;
}

function records(values: CapabilityInventory[CapabilityDomain]): Array<Record<string, unknown>> {
  return values as unknown as Array<Record<string, unknown>>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
