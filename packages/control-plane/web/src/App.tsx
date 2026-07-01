import { isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileJson,
  FlaskConical,
  GitBranch,
  Gauge,
  Image,
  Layers3,
  ListChecks,
  Network,
  Play,
  RefreshCw,
  Route,
  Server,
  Settings,
  Shield,
  Sparkles,
  Target,
  UploadCloud,
  Workflow,
  XCircle
} from "lucide-react";
import { artifactUrl, fetchSnapshot, getConnectionFromLocation, postJson } from "./api/client";
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  EmptyState,
  ExternalArtifactLink,
  KeyValueTable,
  LoadingState,
  MetricCard,
  formatPercent,
  safeText,
  statusTone
} from "./design-system/components";
import type { Failure, RunProfile, Screenshot, Snapshot } from "./types/controlPlane";

type ViewId =
  | "overview"
  | "portfolio"
  | "runbook"
  | "profiles"
  | "actions"
  | "readiness"
  | "risk"
  | "security"
  | "costs"
  | "setup"
  | "runs"
  | "failures"
  | "baselines"
  | "mutation"
  | "coverage"
  | "flows"
  | "config"
  | "targets"
  | "contracts"
  | "schedule"
  | "llm"
  | "providers"
  | "github"
  | "connections"
  | "artifacts";

const viewGroups: Array<{
  label: string;
  views: Array<{ id: ViewId; label: string; icon: typeof Activity; description: string }>;
}> = [
  {
    label: "Operate",
    views: [
      { id: "overview", label: "Overview", icon: Gauge, description: "Current deterministic health, mutation signal, and next actions." },
      { id: "failures", label: "Failure Inbox", icon: AlertTriangle, description: "Actionable failures, likely causes, and reproduction commands." },
      { id: "baselines", label: "Baselines", icon: Image, description: "Screenshot evidence and approve/reject review queue." },
      { id: "runs", label: "Runs / Reports", icon: ClipboardList, description: "Report schema evidence, selected contracts, and artifacts." }
    ]
  },
  {
    label: "Plan",
    views: [
      { id: "portfolio", label: "Portfolio", icon: Boxes, description: "Connected repos and attention queue." },
      { id: "targets", label: "Targets", icon: Server, description: "URL, command, commandGroup, and protected target coverage." },
      { id: "contracts", label: "Contracts", icon: Target, description: "Selector, screenshot, severity, and mutation mapping." },
      { id: "flows", label: "Flows", icon: Route, description: "User-flow coverage and gaps." },
      { id: "schedule", label: "Schedule", icon: Workflow, description: "PR, canary, full, and protected lanes." }
    ]
  },
  {
    label: "Govern",
    views: [
      { id: "readiness", label: "Readiness", icon: CheckCircle2, description: "Merge and release gates." },
      { id: "risk", label: "Risk", icon: AlertTriangle, description: "Risk register and unsafe target exclusions." },
      { id: "security", label: "Security", icon: Shield, description: "Workflow permissions, secrets, and PR safety." },
      { id: "costs", label: "Costs", icon: Gauge, description: "Cost lanes and provider upload controls." },
      { id: "mutation", label: "Mutation", icon: FlaskConical, description: "Contract adequacy through intentional breakage." },
      { id: "coverage", label: "Coverage", icon: Layers3, description: "Coverage findings and improvement recommendations." }
    ]
  },
  {
    label: "Configure",
    views: [
      { id: "setup", label: "Setup", icon: ListChecks, description: "Guided install and workflow recommendations." },
      { id: "config", label: "Config", icon: Settings, description: "Validate and save Visual Hive config drafts." },
      { id: "runbook", label: "Runbook", icon: Play, description: "Allowlisted local command runner." },
      { id: "profiles", label: "Profiles", icon: GitBranch, description: "Grouped run profiles for PR, canary, and governance." },
      { id: "actions", label: "Actions", icon: Archive, description: "Local Control Plane action history." }
    ]
  },
  {
    label: "Integrations",
    views: [
      { id: "providers", label: "Providers", icon: UploadCloud, description: "Optional hosted visual provider policy." },
      { id: "llm", label: "LLM", icon: Sparkles, description: "Prompt-only advisory triage controls." },
      { id: "github", label: "GitHub / CI", icon: GitBranch, description: "Workflow templates and trusted issue pattern." },
      { id: "connections", label: "Connections", icon: Network, description: "Local portfolio connections." },
      { id: "artifacts", label: "Raw Artifacts", icon: FileJson, description: "Report, plan, image, and markdown files." }
    ]
  }
];

const allViews = viewGroups.flatMap((group) => group.views);

export function App() {
  const [activeView, setActiveView] = useState<ViewId>(readHashView);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const connection = useMemo(() => getConnectionFromLocation(), []);

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      setSnapshot(await fetchSnapshot(connection));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    setBusyAction(label);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAction(undefined);
    }
  }

  useEffect(() => {
    void refresh();
    const onHash = () => setActiveView(readHashView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const current = allViews.find((view) => view.id === activeView) ?? allViews[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={21} />
          </div>
          <div>
            <h1>Visual Hive</h1>
            <p>Control Plane</p>
          </div>
        </div>
        <div className="stack">
          <Badge tone={snapshot?.readOnly ? "warning" : "success"}>{snapshot?.readOnly ? "read-only" : "write enabled"}</Badge>
          <div className="status-line">{snapshot?.config?.project?.name ?? "No project loaded"}</div>
        </div>
        {viewGroups.map((group) => (
          <nav className="nav-group" key={group.label}>
            <p className="nav-label">{group.label}</p>
            {group.views.map((view) => {
              const Icon = view.icon;
              return (
                <button
                  className={`nav-button ${activeView === view.id ? "active" : ""}`}
                  key={view.id}
                  onClick={() => {
                    window.location.hash = view.id;
                    setActiveView(view.id);
                  }}
                  type="button"
                >
                  <Icon size={16} />
                  {view.label}
                </button>
              );
            })}
          </nav>
        ))}
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <h2>{current.label}</h2>
            <p>{current.description}</p>
          </div>
          <div className="row">
            {connection && <Badge tone="info">connection: {connection}</Badge>}
            <Button onClick={() => void refresh()}>
              <RefreshCw size={15} />
              Refresh
            </Button>
          </div>
        </header>
        {error && (
          <Card className="span-12">
            <div className="row">
              <XCircle color="var(--vh-danger)" size={18} />
              <strong>{error}</strong>
            </div>
          </Card>
        )}
        {loading && !snapshot ? (
          <LoadingState />
        ) : snapshot ? (
          renderView(activeView, snapshot, {
            connection,
            busyAction,
            runAction
          })
        ) : (
          <EmptyState title="No Control Plane snapshot loaded">Check the config path passed to visual-hive ui.</EmptyState>
        )}
      </main>
    </div>
  );
}

function renderView(
  view: ViewId,
  snapshot: Snapshot,
  actions: {
    connection?: string;
    busyAction?: string;
    runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  }
) {
  switch (view) {
    case "overview":
      return <Overview snapshot={snapshot} />;
    case "failures":
      return <FailureInbox snapshot={snapshot} connection={actions.connection} />;
    case "baselines":
      return <Baselines snapshot={snapshot} connection={actions.connection} runAction={actions.runAction} busyAction={actions.busyAction} />;
    case "runs":
      return <Runs snapshot={snapshot} connection={actions.connection} />;
    case "runbook":
      return <Runbook snapshot={snapshot} runAction={actions.runAction} busyAction={actions.busyAction} connection={actions.connection} />;
    case "profiles":
      return <Profiles snapshot={snapshot} runAction={actions.runAction} busyAction={actions.busyAction} connection={actions.connection} />;
    case "config":
      return <ConfigEditor snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "providers":
      return <Providers snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "llm":
      return <LLM snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "setup":
      return <Setup snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "connections":
      return <Connections snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "artifacts":
      return <Artifacts snapshot={snapshot} connection={actions.connection} />;
    case "portfolio":
      return <Portfolio snapshot={snapshot} />;
    case "targets":
      return <Targets snapshot={snapshot} />;
    case "contracts":
      return <Contracts snapshot={snapshot} />;
    case "mutation":
      return <Mutation snapshot={snapshot} connection={actions.connection} />;
    case "coverage":
      return <Coverage snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
    case "flows":
      return <JsonEvidence title="Flow coverage" data={snapshot.flowAudit ?? (snapshot.coverage as any)?.flows ?? []} />;
    case "schedule":
      return <JsonEvidence title="Schedule lanes" data={snapshot.scheduleAudit ?? snapshot.planLaneSummary ?? snapshot.plan} />;
    case "readiness":
      return <JsonEvidence title="Readiness gates" data={snapshot.readinessReport} />;
    case "risk":
      return <JsonEvidence title="Risk register" data={snapshot.riskReport} />;
    case "security":
      return <JsonEvidence title="Security audit" data={snapshot.securityAudit} />;
    case "costs":
      return <JsonEvidence title="Cost policy" data={snapshot.costAudit} />;
    case "actions":
      return <JsonEvidence title="Control Plane action history" data={snapshot.actionHistory} />;
    case "github":
      return <GitHubView snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} />;
  }
}

function Overview({ snapshot }: { snapshot: Snapshot }) {
  const overview = snapshot.overview;
  const report = snapshot.report;
  const mutationScore = typeof overview.mutationScore === "number" ? overview.mutationScore : snapshot.mutationReport?.score;
  return (
    <div className="view-grid">
      <MetricCard className="span-3" detail={snapshot.config?.project?.name} label="Health" tone="amber" value={overview.healthGrade ?? "unknown"} />
      <MetricCard className="span-3" detail="deterministic contracts" label="Run status" tone={statusTone(overview.deterministicStatus)} value={overview.deterministicStatus} />
      <MetricCard className="span-3" detail="mutation adequacy" label="Mutation" tone={typeof mutationScore === "number" && mutationScore >= 0.7 ? "success" : "warning"} value={formatPercent(mutationScore)} />
      <MetricCard className="span-3" detail="requires review" label="Failures" tone={overview.failedContracts > 0 ? "danger" : "success"} value={overview.failedContracts ?? 0} />
      <Card className="span-7" eyebrow="Next actions" title="Operator queue">
        {overview.nextActions?.length ? (
          <div className="stack">
            {overview.nextActions.map((action) => (
              <div className="compact-item" key={action}>
                {action}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No urgent next actions">The deterministic path has enough evidence for this snapshot.</EmptyState>
        )}
      </Card>
      <Card className="span-5" eyebrow="Evidence" title="Current report">
        <KeyValueTable
          rows={[
            ["Mode", report?.mode ?? "n/a"],
            ["Generated", report?.generatedAt ?? "n/a"],
            ["Selected contracts", report?.selectedContracts?.length ?? 0],
            ["Generated spec", report?.generatedSpecPath ?? "n/a"],
            ["Artifacts", snapshot.artifacts?.length ?? 0]
          ]}
        />
      </Card>
      <Card className="span-12" eyebrow="Why it matters" title="Deterministic-first quality system">
        <p className="card-subtext">
          Visual Hive keeps Playwright contracts as the pass/fail oracle, then layers mutation adequacy, target planning, provider policy,
          and repair-ready context around that evidence.
        </p>
      </Card>
    </div>
  );
}

function FailureInbox({ snapshot, connection }: { snapshot: Snapshot; connection?: string }) {
  const failures = snapshot.failures ?? [];
  if (!failures.length) {
    return <EmptyState title="No failures in the current snapshot">Visual diffs, missing elements, console errors, and mutation survivors will appear here.</EmptyState>;
  }
  return (
    <div className="split">
      <Card title="Failure queue">
        <div className="failure-list">
          {failures.map((failure) => (
            <FailureCard failure={failure} key={`${failure.contractId}-${failure.classification}`} />
          ))}
        </div>
      </Card>
      <Card eyebrow="Artifacts" title="Failure context">
        <div className="stack">
          {failures.flatMap((failure) => failure.artifacts ?? []).slice(0, 12).map((artifact) => (
            <ExternalArtifactLink href={artifactUrl(artifact, "file", connection)} key={artifact} label={artifact} />
          ))}
          {snapshot.triageReport && <CodeBlock value={JSON.stringify(snapshot.triageReport.findings?.slice(0, 4) ?? [], null, 2)} />}
        </div>
      </Card>
    </div>
  );
}

function FailureCard({ failure }: { failure: Failure }) {
  return (
    <article className="failure-item">
      <div className="failure-title">
        <span>{failure.contractId}</span>
        <Badge tone={statusTone(failure.classification)}>{failure.classification}</Badge>
      </div>
      <p className="card-subtext">{failure.errorExcerpt}</p>
      <KeyValueTable
        rows={[
          ["Target", failure.targetId],
          ["Status", <Badge key="status" tone={statusTone(failure.status)}>{failure.status}</Badge>],
          ["Routes", failure.routes?.join(", ") ?? "n/a"],
          ["Reproduce", failure.reproductionCommand ?? "visual-hive run --ci"]
        ]}
      />
      {failure.suggestedNextTests?.length ? (
        <div className="stack">
          <strong>Suggested next tests</strong>
          {failure.suggestedNextTests.map((suggestion) => (
            <div className="compact-item" key={suggestion}>{suggestion}</div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Baselines({
  snapshot,
  connection,
  runAction,
  busyAction
}: {
  snapshot: Snapshot;
  connection?: string;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
}) {
  const screenshots = snapshot.screenshots ?? [];
  if (!screenshots.length) {
    return <EmptyState title="No screenshots found">Run visual-hive run to generate screenshot evidence.</EmptyState>;
  }
  return (
    <div className="view-grid">
      <Card className="span-12" eyebrow="Review policy" title="Baseline queue">
        <p className="card-subtext">Review baseline, actual, and diff images before approving or rejecting. Writes require explicit confirmation.</p>
      </Card>
      {screenshots.map((shot) => (
        <Card className="span-12" key={`${shot.contractId}-${shot.name}-${shot.viewport}`} title={<BaselineTitle shot={shot} />}>
          <BaselineImages shot={shot} connection={connection} />
          <div className="row">
            <ConfirmButton
              disabled={snapshot.readOnly || !shot.canApprove || busyAction === "approve-baseline"}
              message={`Approve actual screenshot as the new baseline for ${shot.contractId}/${shot.name}?`}
              onConfirm={() =>
                runAction("approve-baseline", () =>
                  postJson("/api/baseline/approve", {
                    contractId: shot.contractId,
                    screenshotName: shot.name,
                    viewport: shot.viewport,
                    route: shot.route,
                    confirm: true
                  }, connection)
                )
              }
              variant="primary"
            >
              Approve baseline
            </ConfirmButton>
            <ConfirmButton
              disabled={snapshot.readOnly || !shot.canReject || busyAction === "reject-baseline"}
              message={`Reject screenshot evidence for ${shot.contractId}/${shot.name}?`}
              onConfirm={() =>
                runAction("reject-baseline", () =>
                  postJson("/api/baseline/reject", {
                    contractId: shot.contractId,
                    screenshotName: shot.name,
                    viewport: shot.viewport,
                    route: shot.route,
                    reason: "Rejected from Control Plane review",
                    confirm: true
                  }, connection)
                )
              }
              variant="danger"
            >
              Reject
            </ConfirmButton>
          </div>
        </Card>
      ))}
    </div>
  );
}

function BaselineTitle({ shot }: { shot: Screenshot }) {
  return (
    <span className="row">
      {shot.contractId} / {shot.name}
      <Badge tone={statusTone(shot.status)}>{shot.status}</Badge>
      <Badge>{shot.viewport}</Badge>
      {typeof shot.actualDiffPixelRatio === "number" && <Badge tone={shot.actualDiffPixelRatio > 0 ? "warning" : "success"}>{formatPercent(shot.actualDiffPixelRatio)} diff</Badge>}
    </span>
  );
}

function BaselineImages({ shot, connection }: { shot: Screenshot; connection?: string }) {
  const panels = [
    ["Baseline", shot.baselinePath],
    ["Actual", shot.actualPath],
    ["Diff", shot.diffPath]
  ] as const;
  return (
    <div className="image-grid">
      {panels.map(([label, pathValue]) => (
        <div className="image-panel" key={label}>
          <h4>{label}</h4>
          {pathValue ? <img alt={`${label} for ${shot.contractId} ${shot.name}`} src={artifactUrl(pathValue, "image", connection)} /> : <div className="empty-state">No {label.toLowerCase()} image</div>}
        </div>
      ))}
    </div>
  );
}

function Runs({ snapshot, connection }: { snapshot: Snapshot; connection?: string }) {
  const report = snapshot.report;
  return (
    <div className="view-grid">
      <MetricCard className="span-3" label="Passed" tone="success" value={report?.summary?.passed ?? 0} />
      <MetricCard className="span-3" label="Failed" tone={(report?.summary?.failed ?? 0) > 0 ? "danger" : "success"} value={report?.summary?.failed ?? 0} />
      <MetricCard className="span-3" label="Screenshots failed" tone={(report?.summary?.screenshotsFailed ?? 0) > 0 ? "danger" : "success"} value={report?.summary?.screenshotsFailed ?? 0} />
      <MetricCard className="span-3" label="Console/page errors" tone={(report?.summary?.consoleErrors ?? 0) + (report?.summary?.pageErrors ?? 0) > 0 ? "warning" : "success"} value={(report?.summary?.consoleErrors ?? 0) + (report?.summary?.pageErrors ?? 0)} />
      <Card className="span-6" title="Selected contracts">
        <SimpleTable rows={(report?.selectedContracts ?? []).map((contract) => [contract])} headers={["Contract"]} />
      </Card>
      <Card className="span-6" title="Selected targets">
        <SimpleTable rows={(report?.selectedTargets ?? []).map((target: any) => [target.id, target.kind, target.cost, target.url])} headers={["ID", "Kind", "Cost", "URL"]} />
      </Card>
      <Card className="span-12" title="Per-contract results">
        <SimpleTable
          headers={["Contract", "Target", "Status", "Duration", "Reproduce"]}
          rows={(report?.results ?? []).map((result: any) => [
            result.contractId,
            result.targetId,
            <Badge key="status" tone={statusTone(result.status)}>{result.status}</Badge>,
            `${result.durationMs ?? 0}ms`,
            <CopyButton key="copy" label="Copy" value={result.reproductionCommand ?? "visual-hive run --ci"} />
          ])}
        />
      </Card>
      <Card className="span-12" title="Artifacts">
        <ArtifactList artifacts={report?.artifacts ?? snapshot.artifacts?.map((artifact) => artifact.path) ?? []} connection={connection} />
      </Card>
    </div>
  );
}

function Runbook({
  snapshot,
  runAction,
  busyAction,
  connection
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
}) {
  return (
    <div className="view-grid">
      {(snapshot.runbook?.commands ?? []).map((command) => (
        <Card className="span-6" key={command.id} title={command.label} action={<Badge tone={command.safety === "pr_safe" ? "success" : "warning"}>{command.safety}</Badge>}>
          <p className="card-subtext">{command.description}</p>
          <CodeBlock value={command.command} />
          <div className="row">
            <ConfirmButton
              disabled={snapshot.readOnly || busyAction === command.id || command.safety !== "pr_safe"}
              message={`Run allowlisted command "${command.id}" locally?`}
              onConfirm={() => runAction(command.id, () => postJson("/api/runbook/execute", { commandId: command.id }, connection))}
              variant="primary"
            >
              Run
            </ConfirmButton>
            <CopyButton value={command.command} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function Profiles({
  snapshot,
  runAction,
  busyAction,
  connection
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
}) {
  return (
    <div className="view-grid">
      {(snapshot.runProfiles ?? []).map((profile: RunProfile) => (
        <Card className="span-6" key={profile.id} title={profile.label} action={<Badge tone={profile.enabled ? "success" : "warning"}>{profile.enabled ? "enabled" : "blocked"}</Badge>}>
          <p className="card-subtext">{profile.description}</p>
          <KeyValueTable rows={[["Commands", profile.commandIds.join(", ")], ["Secrets", profile.requiredSecrets.join(", ") || "none"], ["Expected artifacts", profile.expectedArtifacts.join(", ") || "none"]]} />
          {profile.blockedReasons.length ? <CodeBlock value={profile.blockedReasons.join("\n")} /> : null}
          <ConfirmButton
            disabled={snapshot.readOnly || !profile.enabled || busyAction === profile.id}
            message={`Run profile "${profile.id}" locally?`}
            onConfirm={() => runAction(profile.id, () => postJson("/api/runbook/profile", { profileId: profile.id }, connection))}
            variant="primary"
          >
            Run profile
          </ConfirmButton>
        </Card>
      ))}
    </div>
  );
}

function ConfigEditor({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  const [content, setContent] = useState(snapshot.configRaw ?? "");
  useEffect(() => setContent(snapshot.configRaw ?? ""), [snapshot.configRaw]);
  return (
    <div className="view-grid">
      <Card className="span-8" title="visual-hive.config.yaml">
        <textarea aria-label="Visual Hive config" onChange={(event) => setContent(event.target.value)} value={content} />
        <div className="row">
          <Button onClick={() => runAction("validate-config", () => postJson("/api/config/validate", { content }, connection))}>Validate</Button>
          <ConfirmButton
            disabled={snapshot.readOnly}
            message="Save this Visual Hive config draft to disk?"
            onConfirm={() => runAction("save-config", () => postJson("/api/config/save", { content, confirm: true }, connection))}
            variant="primary"
          >
            Save
          </ConfirmButton>
        </div>
      </Card>
      <Card className="span-4" title="Config context">
        <KeyValueTable rows={[["Path", snapshot.configPath], ["Project", snapshot.config?.project?.name ?? "n/a"], ["Type", snapshot.config?.project?.type ?? "n/a"], ["Read-only", snapshot.readOnly ? "yes" : "no"]]} />
        {snapshot.configError && <CodeBlock value={snapshot.configError} />}
      </Card>
    </div>
  );
}

function Providers({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  return (
    <div className="view-grid">
      {(snapshot.providers ?? []).map((provider: any) => (
        <Card className="span-6" key={provider.id} title={provider.label ?? provider.id} action={<Badge tone={statusTone(provider.availability)}>{provider.availability}</Badge>}>
          <KeyValueTable
            rows={[
              ["Role", provider.deterministicRole],
              ["Required env", provider.requiredEnv?.join(", ") || "none"],
              ["Missing env", provider.missingEnv?.join(", ") || "none"],
              ["External calls planned", provider.externalCallsPlanned ?? 0],
              ["Upload allowed", provider.externalUploadAllowed ? "yes" : "no"]
            ]}
          />
          <div className="row">
            <ConfirmButton
              disabled={snapshot.readOnly}
              message={`Record a skip decision for ${provider.label ?? provider.id}?`}
              onConfirm={() => runAction(`provider-${provider.id}`, () => postJson("/api/providers/decision", { providerId: provider.id, decision: "skip", reason: "Recorded from Control Plane", confirm: true }, connection))}
            >
              Record skip
            </ConfirmButton>
            <ConfirmButton
              disabled={snapshot.readOnly}
              message={`Write setup plan for ${provider.label ?? provider.id}?`}
              onConfirm={() => runAction(`provider-plan-${provider.id}`, () => postJson("/api/providers/setup-plan", { providerId: provider.id, confirm: true }, connection))}
            >
              Write setup plan
            </ConfirmButton>
          </div>
        </Card>
      ))}
      <JsonEvidence title="Provider handoff" data={snapshot.providerHandoff ?? snapshot.providerRunReport ?? snapshot.providerSetupPlan} />
    </div>
  );
}

function LLM({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  return (
    <div className="view-grid">
      <Card className="span-6" title="LLM policy">
        <p className="card-subtext">LLM output is advisory only and never the sole pass/fail oracle.</p>
        <ConfirmButton
          disabled={snapshot.readOnly}
          message="Record the decision to keep LLM triage disabled by default?"
          onConfirm={() => runAction("llm-decision", () => postJson("/api/llm/decision", { decision: "keep_disabled", reason: "Prompt-only advisory mode", confirm: true }, connection))}
        >
          Record disabled decision
        </ConfirmButton>
      </Card>
      <Card className="span-6" title="Prompt artifacts">
        <ArtifactList artifacts={[".visual-hive/triage-prompt.md", ".visual-hive/repair-prompt.md", ".visual-hive/missing-tests.md"]} connection={connection} />
      </Card>
      <JsonEvidence title="LLM usage" data={snapshot.llmUsage ?? snapshot.llmDecisionLog} />
    </div>
  );
}

function Setup({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  const recommendation = snapshot.setupRecommendation;
  return (
    <div className="view-grid">
      <Card className="span-5" title="Recommended setup">
        <KeyValueTable rows={[["Profile", (recommendation as any)?.profile ?? "n/a"], ["Playwright", recommendation?.playwright?.status ?? "n/a"], ["Routes detected", recommendation?.detectedRoutes?.length ?? 0], ["Stories detected", recommendation?.detectedStories?.length ?? 0]]} />
        <div className="row">
          <ConfirmButton disabled={snapshot.readOnly} message="Write recommended config?" onConfirm={() => runAction("setup-config", () => postJson("/api/setup/write-config", { confirm: true, force: false }, connection))}>Write config</ConfirmButton>
          <ConfirmButton disabled={snapshot.readOnly} message="Write recommended docs?" onConfirm={() => runAction("setup-docs", () => postJson("/api/setup/write-docs", { confirm: true, force: false }, connection))}>Write docs</ConfirmButton>
          <ConfirmButton disabled={snapshot.readOnly} message="Write setup bundle?" onConfirm={() => runAction("setup-bundle", () => postJson("/api/setup/write-bundle", { confirm: true, force: false }, connection))}>Write bundle</ConfirmButton>
        </div>
      </Card>
      <Card className="span-7" title="Setup progress">
        <CodeBlock value={JSON.stringify(snapshot.setupProgress ?? recommendation?.setupActions ?? [], null, 2)} />
      </Card>
      <JsonEvidence title="Setup PR guidance" data={snapshot.setupPullRequestPlan} />
    </div>
  );
}

function Connections({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  return (
    <div className="view-grid">
      <Card className="span-12" title="Connected repositories">
        <SimpleTable
          headers={["ID", "Label", "Repo path", "Config", "Tags"]}
          rows={(snapshot.connections?.connections ?? []).map((item: any) => [item.id, item.label, item.repoPath, item.configPath, item.tags?.join(", ")])}
        />
      </Card>
      <Card className="span-12" title="Connection actions">
        <p className="card-subtext">Connection writes are local-only and blocked in read-only mode.</p>
        <ConfirmButton disabled={snapshot.readOnly || !connection} message={`Remove active connection ${connection}?`} onConfirm={() => runAction("remove-connection", () => postJson("/api/connections/remove", { id: connection }, undefined))}>Remove active connection</ConfirmButton>
      </Card>
    </div>
  );
}

function Portfolio({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="view-grid">
      <MetricCard className="span-3" label="Connections" value={snapshot.connections?.connections?.length ?? 1} />
      <MetricCard className="span-3" label="Failures" tone={(snapshot.failures?.length ?? 0) > 0 ? "danger" : "success"} value={snapshot.failures?.length ?? 0} />
      <MetricCard className="span-3" label="Risk items" tone="warning" value={(snapshot.riskReport as any)?.summary?.total ?? 0} />
      <MetricCard className="span-3" label="Readiness" tone={statusTone((snapshot.readinessReport as any)?.status)} value={(snapshot.readinessReport as any)?.status ?? "unknown"} />
      <JsonEvidence title="Portfolio attention queue" data={snapshot.connections ?? snapshot.overview.nextActions} />
    </div>
  );
}

function Targets({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Card title="Targets">
      <SimpleTable headers={["ID", "Kind", "Contracts", "Status"]} rows={(snapshot.targets ?? []).map((target) => [target.id, target.config.kind, target.contractIds.join(", "), target.latestStatus ?? "n/a"])} />
    </Card>
  );
}

function Contracts({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Card title="Contracts">
      <SimpleTable
        headers={["ID", "Target", "Severity", "Status", "Mutation"]}
        rows={(snapshot.contracts ?? []).map((contract) => [
          contract.config.id,
          contract.config.target,
          contract.config.severity,
          contract.latestStatus ?? "n/a",
          contract.mutationOperators.join(", ") || "none"
        ])}
      />
    </Card>
  );
}

function Mutation({ snapshot, connection }: { snapshot: Snapshot; connection?: string }) {
  const report = snapshot.mutationReport;
  return (
    <div className="view-grid">
      <MetricCard className="span-4" label="Score" tone={typeof report?.score === "number" && report.score >= (report.minScore ?? 0.7) ? "success" : "warning"} value={formatPercent(report?.score)} />
      <MetricCard className="span-4" label="Killed" tone="success" value={report?.killed ?? 0} />
      <MetricCard className="span-4" label="Survived" tone={((report as any)?.survived ?? 0) > 0 ? "danger" : "success"} value={(report as any)?.survived ?? 0} />
      <Card className="span-12" title="Mutation operators">
        <SimpleTable
          headers={["Operator", "Contracts", "Status", "Expected", "Evidence"]}
          rows={(report?.results ?? []).map((result: any) => [
            result.operator,
            result.selectedContracts?.join(", ") || "not applicable",
            <Badge key="status" tone={statusTone(result.status)}>{result.status}</Badge>,
            result.expectedFailureKinds?.join(", ") || "n/a",
            result.actualFailureExcerpt ?? result.message ?? "n/a"
          ])}
        />
      </Card>
      <Card className="span-12" title="Mutation artifacts">
        <ArtifactList artifacts={(report?.results ?? []).flatMap((result: any) => result.artifacts ?? [])} connection={connection} />
      </Card>
    </div>
  );
}

function Coverage({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  const recommendations = snapshot.coverageImprovementReport?.recommendations ?? [];
  return (
    <div className="view-grid">
      <JsonEvidence title="Coverage report" data={snapshot.coverage} />
      <Card className="span-12" title="Coverage improvement plan">
        {recommendations.length ? (
          <div className="stack">
            {recommendations.map((recommendation: any) => (
              <div className="compact-item" key={recommendation.id}>
                <div className="row">
                  <strong>{recommendation.title ?? recommendation.id}</strong>
                  <Badge tone={statusTone(recommendation.priority)}>{recommendation.priority ?? "review"}</Badge>
                </div>
                <p className="card-subtext">{recommendation.rationale ?? recommendation.description}</p>
                <ConfirmButton
                  disabled={snapshot.readOnly}
                  message={`Apply coverage recommendation ${recommendation.id}?`}
                  onConfirm={() => runAction(`coverage-${recommendation.id}`, () => postJson("/api/coverage/apply-recommendation", { recommendationId: recommendation.id, confirm: true }, connection))}
                >
                  Apply after review
                </ConfirmButton>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No coverage recommendations">Run visual-hive improve-coverage to generate recommendations.</EmptyState>
        )}
      </Card>
    </div>
  );
}

function GitHubView({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  return (
    <div className="view-grid">
      <Card className="span-6" title="Workflow templates">
        <SimpleTable headers={["ID", "Path", "Safety"]} rows={(snapshot.workflowTemplates ?? []).map((template: any) => [template.id, template.path, template.safetyNotes?.join(" ")])} />
        <ConfirmButton disabled={snapshot.readOnly} message="Write Visual Hive workflow templates?" onConfirm={() => runAction("write-workflows", () => postJson("/api/workflows/write-templates", { confirm: true, force: false }, connection))}>
          Write templates
        </ConfirmButton>
      </Card>
      <Card className="span-6" title="Workflow audit">
        <CodeBlock value={JSON.stringify(snapshot.workflowAudit ?? {}, null, 2)} />
      </Card>
      <Card className="span-12" title="Trusted issue creation pattern">
        <p className="card-subtext">PR workflows remain read-only and secret-free. Issue creation belongs in a trusted workflow_run lane that consumes sanitized artifacts.</p>
      </Card>
    </div>
  );
}

function Artifacts({ snapshot, connection }: { snapshot: Snapshot; connection?: string }) {
  return (
    <Card title="Raw artifacts">
      <SimpleTable
        headers={["Path", "Kind", "Bytes"]}
        rows={(snapshot.artifacts ?? []).map((artifact) => [
          <ExternalArtifactLink key="path" href={artifactUrl(artifact.path, artifact.kind === "image" ? "image" : "file", connection)} label={artifact.path} />,
          artifact.kind,
          artifact.bytes
        ])}
      />
    </Card>
  );
}

function JsonEvidence({ title, data }: { title: string; data: unknown }) {
  return (
    <Card className="span-12" title={title}>
      {data ? <CodeBlock value={JSON.stringify(data, null, 2)} /> : <EmptyState title="No evidence yet">Run the matching Visual Hive command to generate this artifact.</EmptyState>}
    </Card>
  );
}

function ArtifactList({ artifacts, connection }: { artifacts: string[]; connection?: string }) {
  const unique = Array.from(new Set((artifacts ?? []).filter(Boolean)));
  if (!unique.length) return <EmptyState title="No artifacts listed" />;
  return (
    <div className="stack">
      {unique.map((artifact) => (
        <ExternalArtifactLink href={artifactUrl(artifact, artifact.endsWith(".png") ? "image" : "file", connection)} key={artifact} label={artifact} />
      ))}
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<unknown>> }) {
  if (!rows.length) return <EmptyState title="No rows" />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{isRenderable(cell) ? cell : safeText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isRenderable(value: unknown): value is ReactElement {
  return isValidElement(value);
}

function readHashView(): ViewId {
  const candidate = window.location.hash.replace(/^#/, "") as ViewId;
  return allViews.some((view) => view.id === candidate) ? candidate : "overview";
}
