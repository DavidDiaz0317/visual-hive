import { isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Clock,
  Eye,
  FileJson,
  FlaskConical,
  Home,
  Image,
  Play,
  RefreshCw,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
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
import type { Failure, RunProfile, Screenshot, Snapshot, Tone } from "./types/controlPlane";

type WorkAreaId = "start" | "run" | "review" | "configure";
type UserMode = "beginner" | "expert";

const workAreas: Array<{ id: WorkAreaId; label: string; icon: typeof Activity; description: string }> = [
  { id: "start", label: "Start", icon: Home, description: "Quality cockpit" },
  { id: "run", label: "Run", icon: Play, description: "Execute and monitor" },
  { id: "review", label: "Review", icon: Eye, description: "Results and evidence" },
  { id: "configure", label: "Configure", icon: Settings, description: "Project and system" }
];

const areaDescriptions: Record<WorkAreaId, string> = {
  start: "Guided next steps, health signals, and the shortest path to useful Visual Hive evidence.",
  run: "Run PR-safe checks, mutation adequacy, canaries, and curated local profiles.",
  review: "Inspect failures, screenshots, baselines, mutation survivors, reports, and reproduction commands.",
  configure: "Tune targets, contracts, schedules, providers, GitHub workflows, LLM policy, and connections."
};

export function App() {
  const [activeArea, setActiveArea] = useState<WorkAreaId>(readHashWorkArea);
  const [mode, setMode] = useState<UserMode>(readUserMode);
  const [expertOpen, setExpertOpen] = useState(() => readUserMode() === "expert");
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
    const onHash = () => setActiveArea(readHashWorkArea());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("visual-hive-control-plane-mode", mode);
    if (mode === "expert") {
      setExpertOpen(true);
    }
  }, [mode]);

  const current = workAreas.find((view) => view.id === activeArea) ?? workAreas[0];

  function selectArea(area: WorkAreaId) {
    window.location.hash = area;
    setActiveArea(area);
  }

  function toggleMode() {
    setMode((currentMode) => (currentMode === "beginner" ? "expert" : "beginner"));
  }

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
        <nav className="primary-nav" aria-label="Primary">
          {workAreas.map((area) => {
            const Icon = area.icon;
            const badge = snapshot?.navigationBadges?.[area.id] ?? 0;
            return (
              <button className={`nav-button ${activeArea === area.id ? "active" : ""}`} key={area.id} onClick={() => selectArea(area.id)} type="button">
                <Icon size={18} />
                <span>
                  <strong>{area.label}</strong>
                  <small>{area.description}</small>
                </span>
                {badge > 0 && <span className="nav-count">{badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-panel">
          <div>
            <strong>{mode === "expert" ? "Expert mode" : "Beginner mode"}</strong>
            <p>{mode === "expert" ? "Commands and raw evidence stay visible." : "Guided workflow with advanced details tucked away."}</p>
          </div>
          <Button onClick={toggleMode} variant="ghost">
            <SlidersHorizontal size={15} />
            {mode === "expert" ? "Beginner" : "Expert"}
          </Button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <h2>{current.id === "start" ? "Quality cockpit" : current.label}</h2>
            <p>{areaDescriptions[current.id]}</p>
          </div>
          <div className="row">
            {connection && <Badge tone="info">connection: {connection}</Badge>}
            <Button ariaLabel={expertOpen ? "Hide expert console" : "Show expert console"} onClick={() => setExpertOpen((value) => !value)} variant={expertOpen ? "primary" : "secondary"}>
              <Terminal size={15} />
              Expert console
            </Button>
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
          <div className="workspace-stack">
            {renderWorkspace(activeArea, snapshot, {
              connection,
              busyAction,
              mode,
              selectArea,
              runAction
            })}
            <ExpertDrawer snapshot={snapshot} connection={connection} mode={mode} open={expertOpen} setOpen={setExpertOpen} />
          </div>
        ) : (
          <EmptyState title="No Control Plane snapshot loaded">Check the config path passed to visual-hive ui.</EmptyState>
        )}
      </main>
    </div>
  );
}

function renderWorkspace(
  area: WorkAreaId,
  snapshot: Snapshot,
  actions: {
    connection?: string;
    busyAction?: string;
    mode: UserMode;
    selectArea: (area: WorkAreaId) => void;
    runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  }
) {
  switch (area) {
    case "start":
      return <StartWorkspace snapshot={snapshot} connection={actions.connection} mode={actions.mode} selectArea={actions.selectArea} />;
    case "run":
      return <RunWorkspace snapshot={snapshot} runAction={actions.runAction} busyAction={actions.busyAction} connection={actions.connection} mode={actions.mode} />;
    case "review":
      return <ReviewWorkspace snapshot={snapshot} runAction={actions.runAction} busyAction={actions.busyAction} connection={actions.connection} mode={actions.mode} />;
    case "configure":
      return <ConfigureWorkspace snapshot={snapshot} runAction={actions.runAction} connection={actions.connection} mode={actions.mode} />;
  }
}

/*
 * The components below intentionally keep the same endpoint and artifact model
 * as the CLI. The UX shift is progressive disclosure: guided cards first, raw
 * evidence and exact commands when the user opens expert mode.
 */

function StartWorkspace({
  snapshot,
  connection,
  mode,
  selectArea
}: {
  snapshot: Snapshot;
  connection?: string;
  mode: UserMode;
  selectArea: (area: WorkAreaId) => void;
}) {
  const overview = snapshot.overview;
  const report = snapshot.report;
  const mutationScore = typeof overview.mutationScore === "number" ? overview.mutationScore : snapshot.mutationReport?.score;
  const createdOrPendingBaselines = snapshot.screenshots.filter((shot) => ["created", "failed", "missing_baseline"].includes(shot.status)).length;
  return (
    <div className="view-grid">
      <GuidedActionPanel className="span-12" snapshot={snapshot} selectArea={selectArea} />
      <SignalCard className="span-3" icon={<Activity size={17} />} label="Project health" tone="amber" value={overview.healthGrade ?? "unknown"} detail={snapshot.config?.project?.name ?? "No config loaded"} />
      <SignalCard className="span-3" icon={<Shield size={17} />} label="PR-safe lane" tone={statusTone(overview.deterministicStatus)} value={overview.deterministicStatus} detail={`${report?.selectedContracts?.length ?? 0} selected contracts`} />
      <SignalCard className="span-3" icon={<FlaskConical size={17} />} label="Mutation score" tone={typeof mutationScore === "number" && mutationScore >= 0.7 ? "success" : "warning"} value={formatPercent(mutationScore)} detail="Adequacy" />
      <SignalCard className="span-3" icon={<AlertTriangle size={17} />} label="Review queue" tone={overview.failedContracts > 0 || createdOrPendingBaselines > 0 ? "danger" : "success"} value={(overview.failedContracts ?? 0) + createdOrPendingBaselines} detail="Failures and visual changes" />
      <VisualEvidenceStrip className="span-7" connection={connection} screenshots={snapshot.screenshots} selectArea={selectArea} />
      <FailurePreview className="span-5" failures={snapshot.failures} selectArea={selectArea} />
      <Card className="span-7" title="First-run guide">
        <ProgressRail steps={snapshot.guidanceState.progress} />
      </Card>
      <Card className="span-5" title="Current report" action={<Button onClick={() => selectArea("review")} variant="ghost">Open report</Button>}>
        <KeyValueTable
          rows={[
            ["Mode", report?.mode ?? "n/a"],
            ["Generated", formatDate(report?.generatedAt)],
            ["Selected contracts", report?.selectedContracts?.length ?? 0],
            ["Baselines", createdOrPendingBaselines ? `${createdOrPendingBaselines} need review` : "clear"],
            ["Artifacts", snapshot.artifacts?.length ?? 0]
          ]}
        />
      </Card>
      {mode === "expert" && <EvidenceDisclosure className="span-12" title="Raw overview evidence" data={{ overview: snapshot.overview, guidanceState: snapshot.guidanceState, navigationBadges: snapshot.navigationBadges }} />}
    </div>
  );
}

function GuidedActionPanel({ className = "", snapshot, selectArea }: { className?: string; snapshot: Snapshot; selectArea: (area: WorkAreaId) => void }) {
  const guidance = snapshot.guidanceState;
  const primary = guidance.primaryAction;
  return (
    <section className={`guided-panel ${className}`}>
      <div className="guided-copy">
        <p className="vh-eyebrow">What should I do next?</p>
        <h3>{guidance.title}</h3>
        <p>{guidance.summary}</p>
        {guidance.blockedReasons.length ? (
          <div className="blocked-note">
            {guidance.blockedReasons.slice(0, 2).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="guided-actions">
        <button className={`next-action tone-${primary.tone ?? "amber"}`} onClick={() => selectArea(primary.area)} type="button">
          <span className="action-index">1</span>
          <span>
            <strong>{primary.label}</strong>
            <small>{primary.description}</small>
          </span>
          <ChevronRight size={18} />
        </button>
        {guidance.secondaryActions.slice(0, 2).map((action, index) => (
          <button className="next-action secondary" key={action.id} onClick={() => selectArea(action.area)} type="button">
            <span className="action-index">{index + 2}</span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}

function ProgressRail({ steps }: { steps: Snapshot["guidanceState"]["progress"] }) {
  return (
    <div className="progress-rail">
      {steps.map((step, index) => (
        <div className={`progress-step progress-${step.status}`} key={step.id}>
          <div className="step-dot">{index + 1}</div>
          <div>
            <strong>{step.label}</strong>
            <p>{step.description}</p>
            <Badge tone={statusTone(step.status)}>{step.status}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function SignalCard({
  className = "",
  icon,
  label,
  value,
  detail,
  tone = "neutral"
}: {
  className?: string;
  icon: ReactElement;
  label: string;
  value: unknown;
  detail?: ReactElement | string;
  tone?: Tone;
}) {
  return (
    <Card className={`signal-card signal-${tone} ${className}`}>
      <div className="signal-label">
        {icon}
        {label}
      </div>
      <div className="signal-value">{safeText(value)}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </Card>
  );
}

function VisualEvidenceStrip({
  className = "",
  screenshots,
  connection,
  selectArea
}: {
  className?: string;
  screenshots: Screenshot[];
  connection?: string;
  selectArea: (area: WorkAreaId) => void;
}) {
  const visible = screenshots.slice(0, 5);
  return (
    <Card className={className} title="Recent visual evidence" action={<Button onClick={() => selectArea("review")} variant="ghost">Review visual changes</Button>}>
      {visible.length ? (
        <div className="evidence-strip">
          {visible.map((shot) => (
            <button className={`evidence-thumb evidence-${statusTone(shot.status)}`} key={`${shot.contractId}-${shot.name}-${shot.viewport}`} onClick={() => selectArea("review")} type="button">
              {shot.actualPath ? <img alt={`${shot.name} ${shot.viewport}`} src={artifactUrl(shot.actualPath, "image", connection)} /> : <div className="empty-thumb">No image</div>}
              <strong>{shot.name}</strong>
              <small>
                {shot.viewport} · {shot.status}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No screenshots yet">Run deterministic checks to capture local visual evidence.</EmptyState>
      )}
    </Card>
  );
}

function FailurePreview({ className = "", failures, selectArea }: { className?: string; failures: Failure[]; selectArea: (area: WorkAreaId) => void }) {
  return (
    <Card className={className} title="Failure Inbox" action={<Button onClick={() => selectArea("review")} variant="ghost">View all</Button>}>
      {failures.length ? (
        <div className="failure-preview-list">
          {failures.slice(0, 3).map((failure) => (
            <button className="failure-preview" key={`${failure.contractId}-${failure.classification}`} onClick={() => selectArea("review")} type="button">
              <AlertTriangle size={16} />
              <span>
                <strong>{failure.contractId}</strong>
                <small>{failure.errorExcerpt}</small>
              </span>
              <Badge tone={statusTone(failure.classification)}>{failure.classification}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No failures">Visual diffs, missing elements, console errors, and mutation survivors will appear here.</EmptyState>
      )}
    </Card>
  );
}

function RunWorkspace({
  snapshot,
  runAction,
  busyAction,
  connection,
  mode
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
  mode: UserMode;
}) {
  const featuredProfiles = ["pr-acceptance", "mutation-audit", "canary-health", "full-safe-plan"];
  const profiles = [...(snapshot.runProfiles ?? [])].sort((a, b) => {
    const aIndex = featuredProfiles.indexOf(a.id);
    const bIndex = featuredProfiles.indexOf(b.id);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
  return (
    <div className="view-grid">
      <Card className="span-12" title="Run center">
        <p className="card-subtext">Choose a safe lane by intent. Visual Hive keeps protected and secret-bearing lanes blocked unless a trusted operator explicitly enables them.</p>
      </Card>
      {profiles.slice(0, mode === "expert" ? profiles.length : 6).map((profile) => (
        <RunProfileCard busyAction={busyAction} connection={connection} key={profile.id} profile={profile} runAction={runAction} snapshot={snapshot} />
      ))}
      <SectionHeader className="span-12" title="Quick commands" description="Copy or run the allowlisted local commands behind the guided profiles." />
      <div className="span-12">
        <Runbook snapshot={snapshot} runAction={runAction} busyAction={busyAction} connection={connection} />
      </div>
      {mode === "expert" && <EvidenceDisclosure className="span-12" title="Runbook raw evidence" data={{ runbook: snapshot.runbook, runProfiles: snapshot.runProfiles, actionHistory: snapshot.actionHistory }} />}
    </div>
  );
}

function RunProfileCard({
  profile,
  snapshot,
  runAction,
  busyAction,
  connection
}: {
  profile: RunProfile;
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
}) {
  return (
    <Card className="span-6 profile-card" title={profile.label} action={<Badge tone={profile.enabled ? "success" : "warning"}>{profile.enabled ? "ready" : "blocked"}</Badge>}>
      <p className="card-subtext">{profile.description}</p>
      <KeyValueTable rows={[["Safety", profile.safety], ["Commands", profile.commandIds.length], ["Artifacts", profile.expectedArtifacts.length], ["Secrets", profile.requiredSecrets.join(", ") || "none"]]} />
      {profile.blockedReasons.length ? <FindingList findings={profile.blockedReasons} tone="warning" /> : null}
      <ConfirmButton
        disabled={snapshot.readOnly || !profile.enabled || busyAction === profile.id}
        message={`Run profile "${profile.id}" locally?`}
        onConfirm={() => runAction(profile.id, () => postJson("/api/runbook/profile", { profileId: profile.id }, connection))}
        variant="primary"
      >
        Run profile
      </ConfirmButton>
    </Card>
  );
}

function ReviewWorkspace({
  snapshot,
  runAction,
  busyAction,
  connection,
  mode
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
  mode: UserMode;
}) {
  return (
    <div className="view-grid">
      <SignalCard className="span-3" icon={<AlertTriangle size={17} />} label="Failures" tone={(snapshot.failures?.length ?? 0) > 0 ? "danger" : "success"} value={snapshot.failures?.length ?? 0} detail="Deterministic and triage findings" />
      <SignalCard className="span-3" icon={<Image size={17} />} label="Baselines" tone={(snapshot.baselineSummary?.pendingReview ?? 0) > 0 ? "warning" : "success"} value={snapshot.baselineSummary?.pendingReview ?? 0} detail="Pending review" />
      <SignalCard className="span-3" icon={<FlaskConical size={17} />} label="Mutation score" tone={typeof snapshot.mutationReport?.score === "number" && snapshot.mutationReport.score >= (snapshot.mutationReport.minScore ?? 0.7) ? "success" : "warning"} value={formatPercent(snapshot.mutationReport?.score)} detail="Adequacy" />
      <SignalCard className="span-3" icon={<Clock size={17} />} label="Last run" tone={statusTone(snapshot.report?.status)} value={snapshot.report?.status ?? "missing"} detail={formatDate(snapshot.report?.generatedAt)} />
      <div className="span-12">
        <FailureInbox snapshot={snapshot} connection={connection} />
      </div>
      <div className="span-12">
        <Baselines snapshot={snapshot} connection={connection} runAction={runAction} busyAction={busyAction} />
      </div>
      <div className="span-12">
        <Mutation snapshot={snapshot} connection={connection} />
      </div>
      <div className="span-12">
        <TestCreationPlanView snapshot={snapshot} runAction={runAction} busyAction={busyAction} connection={connection} mode={mode} />
      </div>
      <div className="span-12">
        <Runs snapshot={snapshot} connection={connection} />
      </div>
      {mode === "expert" && <EvidenceDisclosure className="span-12" title="Review raw evidence" data={{ report: snapshot.report, mutationReport: snapshot.mutationReport, triageReport: snapshot.triageReport, testCreationPlan: snapshot.testCreationPlan }} />}
    </div>
  );
}

function ConfigureWorkspace({
  snapshot,
  runAction,
  connection,
  mode
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  connection?: string;
  mode: UserMode;
}) {
  return (
    <div className="view-grid">
      <SectionHeader className="span-12" title="Project setup" description="Guided install, workflow, and config recommendations." />
      <div className="span-12">
        <Setup snapshot={snapshot} runAction={runAction} connection={connection} />
      </div>
      <div className="span-6">
        <Targets snapshot={snapshot} />
      </div>
      <div className="span-6">
        <Contracts snapshot={snapshot} />
      </div>
      <HumanEvidencePanel className="span-6" title="Readiness" emptyTitle="No readiness report" findings={readinessFindings(snapshot)} data={snapshot.readinessReport} />
      <HumanEvidencePanel className="span-6" title="Risk" emptyTitle="No risk register" findings={riskFindings(snapshot)} data={snapshot.riskReport} />
      <HumanEvidencePanel className="span-6" title="Security" emptyTitle="No security audit" findings={securityFindings(snapshot)} data={snapshot.securityAudit} />
      <HumanEvidencePanel className="span-6" title="Costs" emptyTitle="No cost audit" findings={costFindings(snapshot)} data={snapshot.costAudit} />
      <HumanEvidencePanel className="span-6" title="Schedule" emptyTitle="No schedule audit" findings={scheduleFindings(snapshot)} data={snapshot.scheduleAudit ?? snapshot.planLaneSummary} />
      <HumanEvidencePanel className="span-6" title="Flows" emptyTitle="No flow audit" findings={flowFindings(snapshot)} data={snapshot.flowAudit} />
      <div className="span-12">
        <Coverage snapshot={snapshot} runAction={runAction} connection={connection} />
      </div>
      <SectionHeader className="span-12" title="Providers" description="Optional hosted visual provider policy, readiness, and no-network handoff evidence." />
      <div className="span-12">
        <Providers snapshot={snapshot} runAction={runAction} connection={connection} />
      </div>
      <SectionHeader className="span-12" title="GitHub / CI" description="Workflow templates, PR safety, and trusted issue creation guidance." />
      <div className="span-12">
        <GitHubView snapshot={snapshot} runAction={runAction} connection={connection} />
      </div>
      <SectionHeader className="span-12" title="LLM" description="Prompt-only advisory triage controls; never the verdict authority." />
      <div className="span-12">
        <LLM snapshot={snapshot} runAction={runAction} connection={connection} />
      </div>
      {mode === "expert" && (
        <>
          <div className="span-12">
            <ConfigEditor snapshot={snapshot} runAction={runAction} connection={connection} />
          </div>
          <SectionHeader className="span-12" title="Connections" description="Local multi-repository portfolio connections and health queues." />
          <div className="span-12">
            <Connections snapshot={snapshot} runAction={runAction} connection={connection} />
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ className = "", title, description }: { className?: string; title: string; description: string }) {
  return (
    <div className={`section-header ${className}`}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HumanEvidencePanel({
  className = "",
  title,
  emptyTitle,
  findings,
  data
}: {
  className?: string;
  title: string;
  emptyTitle: string;
  findings: string[];
  data: unknown;
}) {
  return (
    <Card className={className} title={title}>
      {findings.length ? <FindingList findings={findings} /> : <EmptyState title={emptyTitle}>Run the matching Visual Hive command to generate guidance.</EmptyState>}
      <EvidenceDisclosure title={`View raw ${title.toLowerCase()} evidence`} data={data} compact />
    </Card>
  );
}

function FindingList({ findings, tone = "info" }: { findings: string[]; tone?: Tone }) {
  if (!findings.length) return <EmptyState title="No findings" />;
  return (
    <div className="finding-list">
      {findings.slice(0, 6).map((finding) => (
        <div className="finding-item" key={finding}>
          <Badge tone={tone}>{tone === "danger" ? "fix" : tone === "warning" ? "review" : "note"}</Badge>
          <span>{finding}</span>
        </div>
      ))}
    </div>
  );
}

function ExpertDrawer({
  snapshot,
  connection,
  mode,
  open,
  setOpen
}: {
  snapshot: Snapshot;
  connection?: string;
  mode: UserMode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const commands = snapshot.runbook?.commands ?? [];
  const artifacts = snapshot.artifacts ?? [];
  return (
    <section className={`expert-drawer ${open ? "open" : ""}`}>
      <button className="expert-drawer-header" onClick={() => setOpen(!open)} type="button">
        <span>
          <Terminal size={18} />
          <strong>Expert console</strong>
          <small>Commands, artifacts, and advanced controls for power users and agents.</small>
        </span>
        <Badge tone={mode === "expert" ? "amber" : "neutral"}>{mode === "expert" ? "expert mode" : "collapsed"}</Badge>
      </button>
      {open && (
        <div className="expert-drawer-body">
          <Card title="Quick commands">
            <div className="command-list">
              {commands.slice(0, 6).map((command) => (
                <div className="command-row" key={command.id}>
                  <code>{command.command}</code>
                  <CopyButton label="Copy command" value={command.command} />
                </div>
              ))}
            </div>
          </Card>
          <Card title="Artifacts" action={<Badge>{artifacts.length}</Badge>}>
            <ArtifactPreview artifacts={artifacts.slice(0, 8)} connection={connection} />
          </Card>
          <Card title="Run details">
            <KeyValueTable
              rows={[
                ["Mode", snapshot.report?.mode ?? "n/a"],
                ["Target", snapshot.report?.selectedTargets?.map((target: any) => target.id).join(", ") || "n/a"],
                ["Contracts", snapshot.report?.selectedContracts?.length ?? 0],
                ["Generated", formatDate(snapshot.report?.generatedAt)]
              ]}
            />
            <div className="stack">
              <ExternalArtifactLink href={artifactUrl(".visual-hive/report.json", "file", connection)} label="Open report" />
              <ExternalArtifactLink href={artifactUrl(".visual-hive/mutation-report.json", "file", connection)} label="Open mutation report" />
            </div>
          </Card>
          <EvidenceDisclosure className="span-12" title="Raw snapshot evidence" data={{ report: snapshot.report, plan: snapshot.plan, artifacts: snapshot.artifacts }} />
        </div>
      )}
    </section>
  );
}

function ArtifactPreview({ artifacts, connection }: { artifacts: Snapshot["artifacts"]; connection?: string }) {
  if (!artifacts.length) return <EmptyState title="No artifacts indexed" />;
  return (
    <div className="artifact-preview">
      {artifacts.map((artifact) => (
        <ExternalArtifactLink href={artifactUrl(artifact.path, artifact.kind === "image" ? "image" : "file", connection)} key={artifact.path} label={`${artifact.path} · ${artifact.bytes} B`} />
      ))}
    </div>
  );
}

function EvidenceDisclosure({ className = "", title, data, compact = false }: { className?: string; title: string; data: unknown; compact?: boolean }) {
  return (
    <details className={`evidence-disclosure ${compact ? "compact" : ""} ${className}`}>
      <summary>
        <FileJson size={15} />
        {title}
      </summary>
      {data ? <CodeBlock value={JSON.stringify(data, null, 2)} /> : <EmptyState title="No raw evidence yet" />}
    </details>
  );
}

function readinessFindings(snapshot: Snapshot) {
  const report = snapshot.readinessReport as any;
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  const blocked = gates.filter((gate: any) => ["blocked", "failed", "error"].includes(String(gate.status).toLowerCase()));
  if (blocked.length) return blocked.map((gate: any) => `${gate.label ?? gate.id}: ${gate.message ?? gate.status}`);
  if (report?.status) return [`Readiness status: ${report.status}`];
  return [];
}

function riskFindings(snapshot: Snapshot) {
  const risks = Array.isArray((snapshot.riskReport as any)?.risks) ? (snapshot.riskReport as any).risks : [];
  if (risks.length) return risks.map((risk: any) => `${risk.category ?? "risk"}: ${risk.title ?? risk.description ?? risk.severity ?? "review"}`);
  return (snapshot.riskReport as any)?.recommendations ?? [];
}

function securityFindings(snapshot: Snapshot) {
  const findings = Array.isArray((snapshot.securityAudit as any)?.findings) ? (snapshot.securityAudit as any).findings : [];
  if (findings.length) return findings.map((finding: any) => `${finding.severity ?? "review"}: ${finding.message ?? finding.title ?? finding.id}`);
  const score = (snapshot.securityAudit as any)?.summary?.score;
  return typeof score === "number" ? [`Security score: ${score}`] : [];
}

function costFindings(snapshot: Snapshot) {
  const findings = Array.isArray((snapshot.costAudit as any)?.findings) ? (snapshot.costAudit as any).findings : [];
  if (findings.length) return findings.map((finding: any) => `${finding.severity ?? "review"}: ${finding.message ?? finding.title ?? finding.id}`);
  const summary = (snapshot.costAudit as any)?.summary;
  return summary ? [`Local screenshots: ${summary.localScreenshots ?? 0}`, `External uploads allowed: ${summary.externalUploadAllowed ?? false}`] : [];
}

function scheduleFindings(snapshot: Snapshot) {
  const lanes = Array.isArray((snapshot.scheduleAudit as any)?.lanes) ? (snapshot.scheduleAudit as any).lanes : [];
  if (lanes.length) return lanes.map((lane: any) => `${lane.label ?? lane.id}: ${lane.status ?? lane.contractIds?.length ?? "planned"}`);
  const summary = (snapshot.planLaneSummary as any)?.summary;
  return summary ? [`Available plan modes: ${(summary.modes ?? []).join(", ") || "n/a"}`] : [];
}

function flowFindings(snapshot: Snapshot) {
  const recommendations = Array.isArray((snapshot.flowAudit as any)?.recommendations) ? (snapshot.flowAudit as any).recommendations : [];
  if (recommendations.length) return recommendations;
  const summary = (snapshot.flowAudit as any)?.summary;
  return summary ? [`Contracts without flow coverage: ${summary.contractsWithoutFlow ?? 0}`] : [];
}

function coverageFindings(snapshot: Snapshot) {
  const recommendations = snapshot.coverageImprovementReport?.recommendations ?? [];
  if (recommendations.length) {
    return recommendations.slice(0, 5).map((recommendation: any) => `${recommendation.title ?? recommendation.id}: ${recommendation.rationale?.[0] ?? recommendation.description ?? "review"}`);
  }
  const summary = (snapshot.coverage as any)?.summary;
  return summary ? [`Contracts: ${summary.contractCount ?? 0}`, `Routes: ${summary.routeCount ?? 0}`] : [];
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
      <EvidenceDisclosure className="span-12" title="Provider handoff raw evidence" data={snapshot.providerHandoff ?? snapshot.providerRunReport ?? snapshot.providerSetupPlan} />
    </div>
  );
}

function LLM({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  return (
    <div className="view-grid">
      <Card className="span-6" title="LLM policy">
        <p className="card-subtext">LLM output is advisory only and never the verdict authority.</p>
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
      <EvidenceDisclosure className="span-12" title="LLM usage raw evidence" data={snapshot.llmUsage ?? snapshot.llmDecisionLog} />
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
      <EvidenceDisclosure className="span-12" title="Setup PR guidance raw evidence" data={snapshot.setupPullRequestPlan} />
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

function TestCreationPlanView({
  snapshot,
  runAction,
  busyAction,
  connection,
  mode
}: {
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
  mode: UserMode;
}) {
  const plan = snapshot.testCreationPlan;
  const command = snapshot.runbook?.commands?.find((candidate) => candidate.id === "test-creation-plan");
  const recommendations = plan?.recommendations ?? [];
  return (
    <div className="view-grid">
      <Card
        className="span-12"
        title="Test creation plan"
        action={
          <div className="row">
            {command && <CopyButton label="Copy command" value={command.command} />}
            {command && (
              <ConfirmButton
                disabled={snapshot.readOnly || busyAction === command.id}
                message="Regenerate the advisory test creation plan from current evidence?"
                onConfirm={() => runAction(command.id, () => postJson("/api/runbook/execute", { commandId: command.id }, connection))}
              >
                Regenerate
              </ConfirmButton>
            )}
          </div>
        }
      >
        <p className="card-subtext">
          Advisory no-write recommendations for humans and agents. Visual Hive does not write tests or config from this plan, and agents do not decide the verdict.
        </p>
        {plan ? (
          <div className="view-grid">
            <MetricCard className="span-3" label="Recommendations" tone={plan.summary.total > 0 ? "warning" : "success"} value={plan.summary.total} />
            <MetricCard className="span-3" label="High priority" tone={plan.summary.high > 0 ? "danger" : "success"} value={plan.summary.high} />
            <MetricCard className="span-3" label="Mutation survivors" tone={plan.summary.fromMutationSurvivors > 0 ? "warning" : "success"} value={plan.summary.fromMutationSurvivors} />
            <MetricCard className="span-3" label="Write policy" tone="info" value="no-write" />
            {recommendations.slice(0, mode === "expert" ? 12 : 6).map((recommendation: any) => (
              <Card
                className="span-6"
                key={recommendation.id}
                title={recommendation.title}
                action={
                  <div className="row">
                    <Badge tone={recommendation.priority === "high" ? "danger" : recommendation.priority === "medium" ? "warning" : "info"}>{recommendation.priority}</Badge>
                    <Badge tone="info">{recommendation.kind}</Badge>
                  </div>
                }
              >
                <KeyValueTable
                  rows={[
                    ["Source", recommendation.source],
                    ["Contract", recommendation.contractId ?? "n/a"],
                    ["Mutation", recommendation.mutationOperator ?? "n/a"],
                    ["Trusted only", recommendation.trustedOnly ? "yes" : "no"]
                  ]}
                />
                <FindingList findings={[...(recommendation.rationale ?? []), ...(recommendation.suggestedTests ?? [])].slice(0, 5)} />
                {mode === "expert" && recommendation.suggestedConfigYaml && <CodeBlock value={recommendation.suggestedConfigYaml} />}
                {mode === "expert" && <ArtifactList artifacts={recommendation.artifacts ?? []} connection={connection} />}
              </Card>
            ))}
            <EvidenceDisclosure className="span-12" title="View raw test creation plan" data={plan} compact={mode !== "expert"} />
          </div>
        ) : (
          <EmptyState title="No test creation plan yet">
            Run `visual-hive test-creation-plan` after evidence, coverage recommendations, and optional handoff artifacts exist.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

function Coverage({ snapshot, runAction, connection }: { snapshot: Snapshot; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; connection?: string }) {
  const recommendations = snapshot.coverageImprovementReport?.recommendations ?? [];
  return (
    <div className="view-grid">
      <HumanEvidencePanel className="span-12" title="Coverage report" emptyTitle="No coverage report" findings={coverageFindings(snapshot)} data={snapshot.coverage} />
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

function formatDate(value?: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function readHashWorkArea(): WorkAreaId {
  const candidate = window.location.hash.replace(/^#/, "") as WorkAreaId;
  return workAreas.some((area) => area.id === candidate) ? candidate : "start";
}

function readUserMode(): UserMode {
  if (typeof window === "undefined") return "beginner";
  return window.localStorage.getItem("visual-hive-control-plane-mode") === "expert" ? "expert" : "beginner";
}
