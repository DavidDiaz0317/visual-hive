import { isValidElement, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  ClipboardList,
  Eye,
  FileJson,
  FlaskConical,
  Home,
  Image,
  Play,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
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
type AgentTool = NonNullable<Snapshot["providerAgentPacket"]>["allowedTools"][number];

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
      return <StartWorkspace snapshot={snapshot} connection={actions.connection} busyAction={actions.busyAction} mode={actions.mode} selectArea={actions.selectArea} runAction={actions.runAction} />;
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
  busyAction,
  mode,
  selectArea,
  runAction
}: {
  snapshot: Snapshot;
  connection?: string;
  busyAction?: string;
  mode: UserMode;
  selectArea: (area: WorkAreaId) => void;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const overview = snapshot.overview;
  const report = snapshot.report;
  const mutationScore = typeof overview.mutationScore === "number" ? overview.mutationScore : snapshot.mutationReport?.score;
  const createdOrPendingBaselines = snapshot.screenshots.filter((shot) => ["created", "failed", "missing_baseline"].includes(shot.status)).length;
  return (
    <div className="view-grid">
      <GuidedActionPanel className="span-12" snapshot={snapshot} selectArea={selectArea} />
      <AdoptionChecklist className="span-12" snapshot={snapshot} busyAction={busyAction} connection={connection} runAction={runAction} selectArea={selectArea} />
      <SignalCard className="span-3" icon={<Shield size={17} />} label="Visual Hive verdict" tone={verdictTone(overview.visualHiveVerdict)} value={overview.visualHiveVerdict ?? "missing"} detail={`${overview.gatingContributions} gating signals`} />
      <SignalCard className="span-3" icon={<Activity size={17} />} label="Project health" tone="amber" value={overview.healthGrade ?? "unknown"} detail={snapshot.config?.project?.name ?? "No config loaded"} />
      <SignalCard className="span-3" icon={<Shield size={17} />} label="Browser run" tone={statusTone(overview.deterministicStatus)} value={overview.deterministicStatus} detail={`${report?.selectedContracts?.length ?? 0} selected contracts`} />
      <SignalCard className="span-3" icon={<FlaskConical size={17} />} label="Mutation score" tone={typeof mutationScore === "number" && mutationScore >= 0.7 ? "success" : "warning"} value={formatPercent(mutationScore)} detail="Adequacy" />
      <SignalCard className="span-3" icon={<Activity size={17} />} label="Operational pipeline" tone={pipelineTone(snapshot.pipelineReport?.status)} value={snapshot.pipelineReport?.status ?? "missing"} detail={`${snapshot.overview.pipelineSteps ?? 0} steps`} />
      <VerdictContributionPanel className="span-12" snapshot={snapshot} />
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
            ["Pipeline", snapshot.pipelineReport ? `${snapshot.pipelineReport.status}; failed=${snapshot.overview.pipelineFailedSteps ?? 0}` : "not run"],
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

function AdoptionChecklist({
  className = "",
  snapshot,
  selectArea,
  runAction,
  busyAction,
  connection
}: {
  className?: string;
  snapshot: Snapshot;
  selectArea: (area: WorkAreaId) => void;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
}) {
  const checklist = snapshot.guidanceState.adoptionChecklist;
  return (
    <Card className={className} title="Setup/adoption checklist" action={<Button onClick={() => selectArea("configure")} variant="ghost">Open setup</Button>}>
      <p className="card-subtext">From first run to trusted automation: each step explains what is ready, why it matters, and where to go next.</p>
      <SimpleTable
        headers={["Step", "Status", "Why it matters", "Action"]}
        rows={checklist.map((item) => [
          item.step,
          <Badge key="status" tone={statusTone(item.status)}>{item.status}</Badge>,
          item.why,
          <ChecklistActionCell
            busyAction={busyAction}
            connection={connection}
            item={item}
            key="action"
            runAction={runAction}
            selectArea={selectArea}
            snapshot={snapshot}
          />
        ])}
      />
    </Card>
  );
}

function ChecklistActionCell({
  item,
  snapshot,
  selectArea,
  runAction,
  busyAction,
  connection
}: {
  item: Snapshot["guidanceState"]["adoptionChecklist"][number];
  snapshot: Snapshot;
  selectArea: (area: WorkAreaId) => void;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busyAction?: string;
  connection?: string;
}) {
  return (
    <div className="checklist-action">
      <button className="link-button" onClick={() => selectArea(item.area)} type="button">{item.nextAction}</button>
      {item.commandId ? (
        <>
          <small>{item.commandLabel ?? item.commandId}</small>
          <div className="row compact">
            {item.command && <CopyButton label="Copy" value={item.command} />}
            <ConfirmButton
              disabled={!item.commandRunnable || snapshot.readOnly || busyAction === item.commandId}
              message={`Run allowlisted checklist command "${item.commandId}" locally?`}
              onConfirm={() => runAction(item.commandId!, () => postJson("/api/runbook/execute", { commandId: item.commandId }, connection))}
              variant="primary"
            >
              Run
            </ConfirmButton>
          </div>
          {item.commandBlockedReason ? <small className="muted-text">{item.commandBlockedReason}</small> : null}
        </>
      ) : item.commandBlockedReason ? (
        <small className="muted-text">{item.commandBlockedReason}</small>
      ) : null}
    </div>
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

function VerdictContributionPanel({ className = "", snapshot }: { className?: string; snapshot: Snapshot }) {
  const contributions = verdictContributions(snapshot);
  const blocked = contributions.filter((contribution) => contribution.status === "blocked" && contribution.gating).slice(0, 3);
  const failed = contributions.filter((contribution) => contribution.status === "failed" && contribution.gating).slice(0, 3);
  const warnings = contributions.filter((contribution) => contribution.status === "warning").slice(0, 3);
  const visible = blocked.length ? blocked : failed.length ? failed : warnings;
  const verdict = snapshot.overview.visualHiveVerdict ?? "missing";
  const message =
    verdict === "blocked"
      ? "Evidence is blocked by setup, baseline, secret, or policy conditions. Fix those before treating this as a product regression."
      : verdict === "failed"
        ? "Visual Hive found deterministic regression evidence that should be triaged."
        : verdict === "passed"
          ? "Gating evidence is currently passing. Advisory signals can still suggest stronger coverage."
          : "Generate evidence to let Visual Hive assemble a verdict.";
  return (
    <Card
      className={`verdict-panel ${className}`}
      title="Why Visual Hive reached this verdict"
      action={<Badge tone={verdictTone(verdict)}>{verdict}</Badge>}
    >
      <p className="card-subtext">{message}</p>
      <div className="verdict-grid">
        <MetricCard label="Gating" tone="info" value={snapshot.overview.gatingContributions} />
        <MetricCard label="Blocked" tone={snapshot.overview.blockedContributions > 0 ? "warning" : "success"} value={snapshot.overview.blockedContributions} />
        <MetricCard label="Failed" tone={snapshot.overview.failedContributions > 0 ? "danger" : "success"} value={snapshot.overview.failedContributions} />
        <MetricCard label="Advisory" tone="neutral" value={snapshot.overview.advisoryContributions} />
      </div>
      {visible.length ? (
        <div className="contribution-list">
          {visible.map((contribution) => (
            <div className="contribution-row" key={contribution.key}>
              <Badge tone={statusTone(contribution.status)}>{contribution.status}</Badge>
              <div>
                <strong>{contribution.key}</strong>
                <p>{contribution.reason}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No verdict contributions yet">Run evidence or a deterministic check to populate verdict reasons.</EmptyState>
      )}
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
        <AgentForwardWorkflow snapshot={snapshot} runAction={runAction} busyAction={busyAction} connection={connection} mode={mode} />
      </div>
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
        <RunHistoryPanel snapshot={snapshot} connection={connection} mode={mode} />
      </div>
      <div className="span-12">
        <TestCreationPlanView snapshot={snapshot} runAction={runAction} busyAction={busyAction} connection={connection} mode={mode} />
      </div>
      <div className="span-12">
        <Runs snapshot={snapshot} connection={connection} />
      </div>
      {mode === "expert" && <EvidenceDisclosure className="span-12" title="Review raw evidence" data={{ report: snapshot.report, mutationReport: snapshot.mutationReport, triageReport: snapshot.triageReport, runHistory: snapshot.runHistory, evidencePacket: snapshot.evidencePacket, verdictReport: snapshot.verdictReport, handoffPacket: snapshot.handoffPacket, agentPacket: snapshot.agentPacket, handoffAgentPacket: snapshot.handoffAgentPacket, providerAgentPacket: snapshot.providerAgentPacket, testCreationPlan: snapshot.testCreationPlan }} />}
    </div>
  );
}

function RunHistoryPanel({ snapshot, connection, mode }: { snapshot: Snapshot; connection?: string; mode: UserMode }) {
  const history = snapshot.runHistory;
  const historyArtifact = evidenceArtifact(snapshot, "run-history", ".visual-hive/history.json");
  const historyPath = historyArtifact?.path ?? ".visual-hive/history.json";
  if (!history) {
    return (
      <Card title="Run history trends" action={<Badge tone="neutral">missing</Badge>}>
        <EmptyState title="No run history yet">
          Run `visual-hive history --record` after a deterministic run to track trend evidence across executions.
        </EmptyState>
      </Card>
    );
  }

  const summary = history.summary;
  const trend = history.trend;
  const latest = history.entries?.[0];
  const trendTone: Tone = trend.direction === "improved" ? "success" : trend.direction === "regressed" ? "danger" : trend.direction === "unchanged" ? "info" : "neutral";
  const artifactPaths = Array.from(
    new Set(
      [
        historyPath,
        latest?.files?.report,
        latest?.files?.mutationReport,
        latest?.files?.triageReport,
        latest?.files?.baselineReview,
        ...(latest?.artifacts ?? [])
      ].filter((item): item is string => Boolean(item))
    )
  );

  const trendFindings = trend.reasons.length
    ? trend.reasons
    : ["No previous comparable run is available yet. The current run history is trend evidence only."];

  return (
    <Card
      title="Run history trends"
      action={
        <div className="row">
          <Badge tone={trendTone}>{trend.direction}</Badge>
          <ExternalArtifactLink href={artifactUrl(historyPath, "file", connection)} label={historyArtifact?.evidenceResourceTitle ? `Open ${historyArtifact.evidenceResourceTitle}` : "Open history"} />
        </div>
      }
    >
      <p className="card-subtext">
        Longitudinal evidence for flake, baseline stability, mutation adequacy, runtime, and cost review. History helps explain patterns; it does not override the current Visual Hive verdict.
      </p>
      <div className="verdict-grid">
        <MetricCard label="Runs tracked" tone="info" value={summary.runCount} />
        <MetricCard label="Latest status" tone={statusTone(summary.latestStatus)} value={summary.latestStatus ?? "unknown"} />
        <MetricCard label="Mutation trend" tone={typeof summary.latestMutationScore === "number" && summary.latestMutationScore >= 0.7 ? "success" : "warning"} value={formatPercent(summary.latestMutationScore)} />
        <MetricCard label="Visual diffs" tone={summary.totalVisualDiffs > 0 ? "warning" : "success"} value={summary.totalVisualDiffs} />
      </div>
      <KeyValueTable
        rows={[
          ["Latest recorded", formatDate(summary.latestRecordedAt)],
          ["Passed / failed runs", `${summary.passedRuns} / ${summary.failedRuns}`],
          ["Missing baselines", summary.totalMissingBaselines],
          ["Created baselines", summary.totalCreatedBaselines],
          ["Average mutation score", formatPercent(summary.averageMutationScore)],
          ["Evidence resource", historyArtifact?.evidenceResourceUri ?? "catalog metadata pending"]
        ]}
      />
      <FindingList findings={mode === "expert" ? trendFindings : trendFindings.slice(0, 3)} tone={trendTone === "danger" ? "danger" : trendTone === "neutral" ? "info" : trendTone} />
      {mode === "expert" && (
        <>
          <ArtifactList artifacts={artifactPaths.slice(0, 10)} connection={connection} />
          <EvidenceDisclosure title="View raw run history evidence" data={history} compact />
        </>
      )}
    </Card>
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
      <SchemaCatalogPanel className="span-12" snapshot={snapshot} runAction={runAction} connection={connection} />
      <HumanEvidencePanel
        className="span-6"
        title="Readiness"
        emptyTitle="No readiness report"
        findings={readinessFindings(snapshot)}
        data={snapshot.readinessReport}
        snapshot={snapshot}
        connection={connection}
        artifactResourceId="readiness-gate"
        artifactPath=".visual-hive/readiness.json"
      />
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
  data,
  snapshot,
  connection,
  artifactResourceId,
  artifactPath
}: {
  className?: string;
  title: string;
  emptyTitle: string;
  findings: string[];
  data: unknown;
  snapshot?: Snapshot;
  connection?: string;
  artifactResourceId?: string;
  artifactPath?: string;
}) {
  const linkedArtifactPath = snapshot && artifactResourceId && artifactPath ? evidenceArtifactPath(snapshot, artifactResourceId, artifactPath) : artifactPath;
  return (
    <Card className={className} title={title}>
      {findings.length ? <FindingList findings={findings} /> : <EmptyState title={emptyTitle}>Run the matching Visual Hive command to generate guidance.</EmptyState>}
      {linkedArtifactPath ? <ExternalArtifactLink href={artifactUrl(linkedArtifactPath, "file", connection)} label={`Open ${title.toLowerCase()} artifact`} /> : null}
      <EvidenceDisclosure title={`View raw ${title.toLowerCase()} evidence`} data={data} compact />
    </Card>
  );
}

function SchemaCatalogPanel({
  className = "",
  snapshot,
  runAction,
  connection
}: {
  className?: string;
  snapshot: Snapshot;
  runAction: (label: string, action: () => Promise<unknown>) => Promise<void>;
  connection?: string;
}) {
  const catalog = snapshot.schemaCatalog;
  const command = snapshot.runbook?.commands?.find((candidate) => candidate.id === "schemas-verify");
  const schemaCatalogArtifact = evidenceArtifact(snapshot, "schema-catalog", ".visual-hive/schema-catalog.json");
  const schemaCatalogPath = schemaCatalogArtifact?.path ?? ".visual-hive/schema-catalog.json";
  const status = catalog?.status ?? "missing";
  const findings = schemaCatalogFindings(snapshot);
  return (
    <Card
      className={className}
      title="Schema/catalog health"
      action={
        <div className="row">
          <Badge tone={statusTone(status)}>{status}</Badge>
          {command && <CopyButton label="Copy command" value={command.command} />}
          {command && (
            <ConfirmButton
              disabled={snapshot.readOnly}
              message="Verify schema/catalog drift and refresh the local evidence artifact?"
              onConfirm={() => runAction(command.id, () => postJson("/api/runbook/execute", { commandId: command.id }, connection))}
              variant="primary"
            >
              Verify
            </ConfirmButton>
          )}
        </div>
      }
    >
      <p className="card-subtext">
        This checks that JSON Schemas, MCP resources, Tool Registry cards, Agent Packets, Context Ledger metadata, and artifact evidence-resource IDs still describe the same system.
      </p>
      <div className="verdict-grid">
        <MetricCard label="Schemas checked" tone="info" value={catalog?.summary.schemasChecked ?? 0} />
        <MetricCard label="Checks" tone="info" value={catalog?.summary.checks ?? 0} />
        <MetricCard label="Failed" tone={(catalog?.summary.failed ?? 0) > 0 ? "danger" : "success"} value={catalog?.summary.failed ?? 0} />
        <MetricCard label="Read tools" tone="neutral" value={catalog?.summary.evidenceReadTools ?? 0} />
      </div>
      <FindingList findings={findings} tone={status === "failed" ? "danger" : status === "missing" ? "warning" : "info"} />
      <div className="row">
        <ExternalArtifactLink href={artifactUrl(schemaCatalogPath, "file", connection)} label={schemaCatalogArtifact?.evidenceResourceTitle ? `Open ${schemaCatalogArtifact.evidenceResourceTitle} artifact` : "Open schema catalog artifact"} />
      </div>
      <EvidenceDisclosure title="View raw schema catalog evidence" data={catalog} compact />
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
          <Card title="Linked evidence resources" action={<Badge>{snapshot.contextLedger?.toolCalls?.length ?? 0}</Badge>}>
            <ContextLedgerEvidenceLinks snapshot={snapshot} connection={connection} />
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
              <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "latest-report", ".visual-hive/report.json"), "file", connection)} label="Open report" />
              <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "mutation-report", ".visual-hive/mutation-report.json"), "file", connection)} label="Open mutation report" />
              <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "context-ledger", ".visual-hive/context-ledger.json"), "file", connection)} label="Open context ledger" />
            </div>
          </Card>
          <EvidenceDisclosure
            className="span-12"
            title="Raw snapshot evidence"
            data={{ report: snapshot.report, plan: snapshot.plan, schemaCatalog: snapshot.schemaCatalog, hiveExport: snapshot.hiveExport, artifacts: snapshot.artifacts }}
          />
        </div>
      )}
    </section>
  );
}

function ArtifactPreview({ artifacts, connection }: { artifacts: Snapshot["artifacts"]; connection?: string }) {
  if (!artifacts.length) return <EmptyState title="No artifacts indexed" />;
  return (
    <div className="artifact-preview">
      {artifacts.map((artifact) => {
        const label = artifact.evidenceResourceTitle ? `${artifact.evidenceResourceTitle} · ${artifact.path} · ${artifact.bytes} B` : `${artifact.path} · ${artifact.bytes} B`;
        return <ExternalArtifactLink href={artifactUrl(artifact.path, artifact.kind === "image" ? "image" : "file", connection)} key={artifact.path} label={label} />;
      })}
    </div>
  );
}

function ContextLedgerEvidenceLinks({ snapshot, connection }: { snapshot: Snapshot; connection?: string }) {
  const linkedToolCalls = (snapshot.contextLedger?.toolCalls ?? [])
    .map((call) => ({
      ...call,
      linkedResources:
        call.evidenceResources?.length
          ? call.evidenceResources
          : call.evidenceResourceId && call.evidenceResourceUri
            ? [
                {
                  evidenceResourceId: call.evidenceResourceId,
                  evidenceResourceUri: call.evidenceResourceUri,
                  evidenceResourceTitle: call.evidenceResourceTitle ?? call.evidenceResourceId,
                  evidenceResourceDescription: call.evidenceResourceDescription ?? "",
                  evidenceReadToolName: call.evidenceReadToolName,
                  artifactPath: call.artifacts?.[0] ?? ""
                }
              ]
            : []
    }))
    .filter((call) => call.linkedResources.length);
  if (!linkedToolCalls.length) {
    return <EmptyState title="No linked evidence resources">Run visual-hive context after pipeline artifacts exist.</EmptyState>;
  }
  return (
    <div className="linked-evidence-list">
      {linkedToolCalls.slice(0, 4).map((call) => (
        <div className="linked-evidence-row" key={call.id}>
          <div>
            <strong>{call.label}</strong>
            <small>
              {call.toolId} - {call.status}
            </small>
          </div>
          <div className="linked-evidence-links">
            {call.linkedResources.slice(0, 6).map((resource) => (
              <ExternalArtifactLink
                href={artifactUrl(resource.artifactPath, "file", connection)}
                key={`${call.id}:${resource.evidenceResourceId}:${resource.artifactPath}`}
                label={`${resource.evidenceResourceTitle} - ${resource.evidenceReadToolName ?? resource.evidenceResourceUri}`}
              />
            ))}
          </div>
        </div>
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

function AgentForwardWorkflow({
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
  const profile = snapshot.runProfiles?.find((candidate) => candidate.id === "agent-handoff-review");
  const verdict =
    snapshot.report?.verdictSummary?.visualHiveVerdict ??
    snapshot.verdictReport?.summary?.visualHiveVerdict ??
    snapshot.evidencePacket?.verdictSummary?.visualHiveVerdict ??
    snapshot.handoffPacket?.verdict?.visualHiveVerdict ??
    snapshot.agentPacket?.verdict?.visualHiveVerdict;
  const gatingCount =
    snapshot.report?.verdictContributions?.filter((contribution) => contribution.gating).length ??
    snapshot.verdictReport?.summary?.gatingContributions ??
    snapshot.agentPacket?.evidenceSummary?.gatingContributions?.length ??
    snapshot.evidencePacket?.evidenceContributions?.filter((contribution) => contribution.gating).length ??
    0;
  const advisoryCount =
    snapshot.report?.verdictContributions?.filter((contribution) => !contribution.gating).length ??
    snapshot.verdictReport?.summary?.advisoryContributions ??
    snapshot.agentPacket?.evidenceSummary?.advisoryContributions?.length ??
    snapshot.evidencePacket?.evidenceContributions?.filter((contribution) => !contribution.gating).length ??
    0;
  const pipelineStatus = snapshot.pipelineReport?.status ?? "missing";
  const workItems = snapshot.handoffPacket?.workItems ?? snapshot.agentPacket?.evidenceSummary?.workItems ?? [];
  const blockedReasons = snapshot.handoffPacket?.blockedReasons ?? snapshot.evidencePacket?.hiveReadiness?.blockedReasons ?? [];
  const packetArtifacts = [
    evidenceArtifactPath(snapshot, "latest-evidence", ".visual-hive/evidence-packet.json"),
    evidenceArtifactPath(snapshot, "latest-verdict", ".visual-hive/verdict.json"),
    evidenceArtifactPath(snapshot, "latest-handoff", ".visual-hive/handoff.json"),
    evidenceArtifactPath(snapshot, "hive-export", ".visual-hive/hive/hive-export.json"),
    evidenceArtifactPath(snapshot, "hive-guarded-repair-preview", ".visual-hive/hive/guarded-repair-preview.json"),
    evidenceArtifactPath(snapshot, "hive-repair-request-envelope", ".visual-hive/hive/repair-request-envelope.json"),
    evidenceArtifactPath(snapshot, "hive-trusted-repair-consumer-summary", ".visual-hive/hive/trusted-repair-consumer-summary.json"),
    evidenceArtifactPath(snapshot, "hive-trusted-repair-workflow-dry-run", ".visual-hive/hive/trusted-repair-workflow-dry-run.json"),
    evidenceArtifactPath(snapshot, "agent-packet", ".visual-hive/agent-packet.json"),
    evidenceArtifactPath(snapshot, "test-creation-plan", ".visual-hive/test-creation-plan.json")
  ];
  const hiveArtifacts = [
    evidenceArtifactPath(snapshot, "hive-export", ".visual-hive/hive/hive-export.json"),
    evidenceArtifactPath(snapshot, "hive-beads", ".visual-hive/hive/beads.json"),
    evidenceArtifactPath(snapshot, "hive-knowledge-facts", ".visual-hive/hive/knowledge-facts.json"),
    evidenceArtifactPath(snapshot, "hive-knowledge-graph", ".visual-hive/hive/knowledge-graph.json"),
    evidenceArtifactPath(snapshot, "hive-wiki-index", ".visual-hive/hive/wiki-index.json"),
    ".visual-hive/hive/issue-context.md",
    evidenceArtifactPath(snapshot, "hive-repair-work-orders", ".visual-hive/hive/repair-work-orders.json"),
    evidenceArtifactPath(snapshot, "hive-agent-policy", ".visual-hive/hive/hive-agent-policy.json"),
    evidenceArtifactPath(snapshot, "hive-guarded-repair-preview", ".visual-hive/hive/guarded-repair-preview.json"),
    ".visual-hive/hive/guarded-repair-preview.md",
    evidenceArtifactPath(snapshot, "hive-repair-request-envelope", ".visual-hive/hive/repair-request-envelope.json"),
    ".visual-hive/hive/repair-request-envelope.md",
    evidenceArtifactPath(snapshot, "hive-trusted-repair-consumer-summary", ".visual-hive/hive/trusted-repair-consumer-summary.json"),
    ".visual-hive/hive/trusted-repair-consumer-summary.md",
    evidenceArtifactPath(snapshot, "hive-trusted-repair-workflow-dry-run", ".visual-hive/hive/trusted-repair-workflow-dry-run.json"),
    ".visual-hive/hive/trusted-repair-workflow-dry-run.md"
  ];
  const hiveExport = snapshot.hiveExport;
  const guardedRepairPreview = snapshot.hiveGuardedRepairPreview;
  const repairRequestEnvelope = snapshot.hiveRepairRequestEnvelope;
  const trustedRepairConsumerSummary = snapshot.hiveTrustedRepairConsumerSummary;
  const trustedRepairWorkflowDryRun = snapshot.hiveTrustedRepairWorkflowDryRun;
  const hiveModeComparison = snapshot.hiveModeComparison;
  const hiveReadiness = snapshot.evidencePacket?.hiveReadiness;
  const hiveModeReadiness = hiveReadiness?.modeReadiness ?? [];
  const hiveModeReadinessByMode = new Map(hiveModeReadiness.map((entry) => [entry.mode, entry]));
  const readyHiveModes = hiveModeReadiness.filter((entry) => entry.status === "ready").length;
  const trustedHiveModes = hiveModeReadiness.filter((entry) => entry.status === "trusted_only").length;
  const blockedHiveModes = hiveModeReadiness.filter((entry) => entry.status === "blocked").length;
  const hivePreviewLimit = mode === "expert" ? 8 : 3;
  const hiveBeads = hiveExport?.beads ?? [];
  const hiveFacts = hiveExport?.knowledgeFacts ?? [];
  const hiveGraphEdges = hiveExport?.knowledgeGraph?.edges ?? [];
  const repairOrders = hiveExport?.repairWorkOrders ?? [];
  const wikiVaultDir = hiveExport?.outputArtifacts?.wikiVaultDir;
  const hiveWikiPages = hiveExport?.wikiIndex?.pages ?? [];
  const wikiArtifacts = hiveWikiPages.length
    ? hiveWikiPages.slice(0, hivePreviewLimit).map((page) => page.path)
    : wikiVaultDir
      ? hiveFacts.slice(0, hivePreviewLimit).map((fact) => `${wikiVaultDir}/${fact.slug}.md`)
      : [];
  const hiveModeCommands = [
    {
      id: "hive-export-advisory",
      mode: "Advisory",
      emits: "Issue context and agent policy.",
      control: "No Beads or repair work orders; safest default.",
      command: snapshot.runbook?.commands?.find((candidate) => candidate.id === "hive-export-advisory")
    },
    {
      id: "hive-export-measured",
      mode: "Measured",
      emits: "Beads, knowledge facts, graph, wiki pages, issue context.",
      control: "Queues and context only; still zero external calls.",
      command: snapshot.runbook?.commands?.find((candidate) => candidate.id === "hive-export-measured")
    },
    {
      id: "hive-export-repair-request",
      mode: "Repair request",
      emits: "Repair work orders, forbidden actions, acceptance criteria.",
      control: "PR-only repair instructions; Visual Hive rerun required.",
      command: snapshot.runbook?.commands?.find((candidate) => candidate.id === "hive-export-repair-request")
    },
    {
      id: "hive-export-guarded",
      mode: "Guarded repair",
      emits: "Future trusted branch/PR repair lane.",
      control: "Displayed as policy; not launched from local UI.",
      command: undefined
    },
    {
      id: "hive-export-full",
      mode: "Full",
      emits: "Reserved mature automation mode.",
      control: "Blocked locally until governance is proven.",
      command: undefined
    }
  ];
  const recommendedHiveMode = hiveReadiness?.recommendedMode;
  const recommendedHiveReadiness =
    (recommendedHiveMode ? hiveModeReadinessByMode.get(recommendedHiveMode) : undefined) ??
    hiveModeReadiness.find((entry) => entry.status === "ready") ??
    hiveModeReadiness[0];
  const recommendedHiveCommand = recommendedHiveReadiness
    ? hiveModeCommands.find((entry) => entry.id === hiveCommandIdForMode(recommendedHiveReadiness.mode))?.command
    : undefined;
  const repairReadiness = trustedRepairReadinessState(snapshot);
  return (
    <Card
      title="Evidence to agent handoff"
      action={
        <div className="row">
          {profile && <CopyButton label="Copy profile command" value={profile.commandIds.join(" -> ")} />}
          {profile && (
            <ConfirmButton
              disabled={snapshot.readOnly || !profile.enabled || busyAction === profile.id}
              message="Regenerate the sanitized Evidence Packet, verdict, Hive dry run, test plan, and Agent Packet?"
              onConfirm={() => runAction(profile.id, () => postJson("/api/runbook/profile", { profileId: profile.id }, connection))}
              variant="primary"
            >
              Refresh handoff packet
            </ConfirmButton>
          )}
        </div>
      }
    >
      <p className="card-subtext">
        A guided chain from deterministic evidence to repair-ready handoff. Visual Hive owns the verdict; Hive, LLMs, MCP tools, and agents only consume this packet and recommend actions.
      </p>
      <div className="view-grid">
        <div className="guided-panel span-12">
          <div className="guided-copy">
            <Badge tone={repairReadiness.tone}>{repairReadiness.state}</Badge>
            <h3>Trusted repair readiness</h3>
            <p>{repairReadiness.summary}</p>
          </div>
          <div className="guided-actions">
            <div className={`next-action tone-${repairReadiness.tone}`}>
              <ArrowRight size={18} />
              <span>
                <strong>{repairReadiness.primaryAction}</strong>
                <small>{repairReadiness.whyItMatters}</small>
              </span>
              <Badge tone={repairReadiness.tone}>{repairReadiness.actionBadge}</Badge>
            </div>
            <div className="next-action secondary">
              <ShieldCheck size={18} />
              <span>
                <strong>Safety boundary</strong>
                <small>No checkout, branch, pull request, issue, Hive call, provider call, repair execution, or Visual Hive rerun happens in this local dry run.</small>
              </span>
              <Badge tone="success">guarded</Badge>
            </div>
            <div className="next-action secondary">
              <ClipboardList size={18} />
              <span>
                <strong>Evidence chain</strong>
                <small>{repairReadiness.chainSummary}</small>
              </span>
              <Badge tone={repairReadiness.chainComplete ? "success" : "warning"}>{repairReadiness.chainComplete ? "complete" : "incomplete"}</Badge>
            </div>
          </div>
        </div>
        <MetricCard className="span-3" label="Visual Hive verdict" tone={verdictTone(verdict)} value={verdict ?? "missing"} />
        <MetricCard className="span-3" label="Gating evidence" tone={gatingCount > 0 ? "success" : "warning"} value={gatingCount} />
        <MetricCard className="span-3" label="Agent work items" tone={workItems.length > 0 ? "warning" : "success"} value={workItems.length} />
        <MetricCard className="span-3" label="Pipeline" tone={pipelineTone(snapshot.pipelineReport?.status)} value={pipelineStatus} />
        <Card className="span-12" title="Automation ladder">
          <p className="card-subtext">
            Visual Hive can package the same deterministic evidence for different levels of follow-up. Start with advisory context, then move toward repair only after policy, branch isolation, bounded tools, human review, and a fresh Visual Hive rerun are explicit.
          </p>
          <SimpleTable
            headers={["Level", "What it gives Hive or agents", "Default safety state"]}
            rows={[
              ["Advisory", "Sanitized issue context and evidence summary for humans or agents to read.", "Local dry run; no external calls."],
              ["Measured", "Beads, wiki facts, and knowledge graph edges that preserve repo/testing context.", "Local dry run; evidence only."],
              ["Repair request", "Guarded work orders with likely files, reproduction commands, and acceptance criteria.", "Local dry run; no branch or PR."],
              ["Guarded repair", "A trusted workflow plan that can later isolate branches and rerun Visual Hive after repair.", "Trusted workflow required."],
              ["Full", "Reserved for mature automation after governance is proven.", "Full automation remains blocked locally."]
            ]}
          />
        </Card>
        <Card className="span-6" title="Hive readiness next step">
          <p className="card-subtext">
            Start with the safest ready Hive mode. Trusted repair lanes stay blocked until policy, branch isolation, human review, and a Visual Hive rerun are explicit.
          </p>
          <KeyValueTable
            rows={[
              ["Recommended mode", hiveReadiness?.recommendedMode ?? "missing"],
              ["Status", recommendedHiveReadiness ? <Badge key="status" tone={hiveReadinessTone(recommendedHiveReadiness.status)}>{recommendedHiveReadiness.status}</Badge> : "missing"],
              ["Why", hiveReadiness?.recommendationReason ?? recommendedHiveReadiness?.reason ?? "Run visual-hive evidence after deterministic artifacts exist."],
              ["Next command", recommendedHiveReadiness?.nextCommand ?? "visual-hive evidence"],
              ["Local preview allowed", recommendedHiveReadiness?.localPreviewAllowed ? "yes" : "no"],
              ["Trusted workflow required", recommendedHiveReadiness?.trustedWorkflowRequired ? "yes" : "no"],
              ["Ready / trusted / blocked", `${readyHiveModes} ready / ${trustedHiveModes} trusted-only / ${blockedHiveModes} blocked`]
            ]}
          />
          {recommendedHiveReadiness?.blockedReasons.length ? <FindingList findings={recommendedHiveReadiness.blockedReasons} tone="warning" /> : null}
          <div className="row">
            <CopyButton label="Copy next command" value={recommendedHiveReadiness?.nextCommand ?? "visual-hive evidence"} />
            {recommendedHiveCommand && recommendedHiveReadiness?.localPreviewAllowed ? (
              <ConfirmButton
                disabled={snapshot.readOnly || busyAction === recommendedHiveCommand.id}
                message={`Run ${recommendedHiveReadiness.mode} Hive preview locally?`}
                onConfirm={() => runAction(recommendedHiveCommand.id, () => postJson("/api/runbook/execute", { commandId: recommendedHiveCommand.id }, connection))}
                variant="primary"
              >
                Run recommended preview
              </ConfirmButton>
            ) : null}
          </div>
        </Card>
        <Card className="span-6" title="Packet chain">
          <KeyValueTable
            rows={[
              ["Pipeline", snapshot.pipelineReport ? `${snapshot.pipelineReport.status}; steps=${snapshot.pipelineReport.steps.length}` : "missing"],
              ["Evidence Packet", snapshot.evidencePacket ? "ready" : "missing"],
              ["Verdict Report", snapshot.verdictReport ? "ready" : "missing"],
              ["Handoff Packet", snapshot.handoffPacket ? `${snapshot.handoffPacket.status}; calls=${snapshot.handoffPacket.externalCallsMade}` : "missing"],
              ["Hive native export", snapshot.hiveExport ? `${snapshot.hiveExport.mode}; calls=${snapshot.hiveExport.externalCallsMade}` : "missing"],
              ["Guarded repair preview", guardedRepairPreview ? `${guardedRepairPreview.status}; ready=${guardedRepairPreview.readiness.canRequestGuardedRepair}` : "missing"],
              ["Repair request envelope", repairRequestEnvelope ? `${repairRequestEnvelope.status}; ready=${repairRequestEnvelope.readiness.canOpenTrustedRepairRequest}` : "missing"],
              [
                "Trusted repair consumer",
                trustedRepairConsumerSummary ? `${trustedRepairConsumerSummary.status}; workflowReady=${trustedRepairConsumerSummary.readiness.canStartTrustedRepairWorkflow}` : "missing"
              ],
              [
                "Trusted workflow dry run",
                trustedRepairWorkflowDryRun ? `${trustedRepairWorkflowDryRun.status}; ready=${trustedRepairWorkflowDryRun.readiness.canRunTrustedRepairWorkflow}` : "missing"
              ],
              ["Agent Packet", snapshot.agentPacket ? `${snapshot.agentPacket.profile}; network=${snapshot.agentPacket.budgets.allowExternalNetwork}` : "missing"],
              ["Advisory evidence", advisoryCount]
            ]}
          />
          <ArtifactList artifacts={packetArtifacts} connection={connection} />
        </Card>
        <Card className="span-6" title="Hive export mode policy">
          <p className="card-subtext">
            Pick how much structured work Visual Hive gives Hive. Every preview is local, dry-run, and keeps Visual Hive as the verdict authority.
          </p>
          <KeyValueTable
            rows={[
              ["Evidence Packet readiness", hiveReadiness ? "ready" : "missing"],
              ["Pre-export recommendation", hiveReadiness?.recommendedMode ?? "missing"],
              ["Recommended mode", hiveReadiness?.recommendedMode ?? hiveModeComparison?.recommendation.mode ?? "missing"],
              ["Recommendation reason", hiveReadiness?.recommendationReason ?? hiveModeComparison?.recommendation.reason ?? "Run visual-hive evidence after deterministic artifacts exist."],
              ["Comparison artifact", hiveModeComparison?.outputArtifacts.comparison ?? "missing"],
              ["Comparison recommendation", hiveModeComparison?.recommendation.mode ?? "missing"],
              ["External calls", hiveModeComparison?.externalCallsMade ?? 0]
            ]}
          />
          <SimpleTable
            headers={["Mode", "Readiness", "Control"]}
            rows={
              hiveModeComparison
                ? hiveModeComparison.modes.slice(0, mode === "expert" ? hiveModeComparison.modes.length : 3).map((entry) => [
                    entry.mode,
                    hiveModeReadinessByMode.get(entry.mode)?.status ?? entry.status,
                    `${entry.summary.beads} Beads, ${entry.summary.knowledgeFacts} facts, ${entry.summary.repairWorkOrders} repair orders; ${
                      hiveModeReadinessByMode.get(entry.mode)?.trustedWorkflowRequired ?? entry.policy.trustedWorkflowRequired ? "trusted workflow required" : "local dry-run preview"
                    }`
                  ])
                : hiveModeReadiness.length
                  ? hiveModeReadiness.slice(0, mode === "expert" ? hiveModeReadiness.length : 3).map((entry) => [
                      entry.mode,
                      entry.status,
                      `${Object.entries(entry.emits)
                        .filter(([, enabled]) => enabled)
                        .map(([capability]) => capability)
                        .join(", ")}; ${entry.nextCommand}`
                    ])
                : hiveModeCommands.slice(0, mode === "expert" ? hiveModeCommands.length : 3).map((entry) => [
                    entry.mode,
                    "not generated",
                    entry.control
                  ])
            }
          />
          {hiveModeReadiness.some((entry) => entry.blockedReasons.length) ? (
            <FindingList
              findings={hiveModeReadiness.flatMap((entry) => entry.blockedReasons.map((reason) => `${entry.mode}: ${reason}`)).slice(0, mode === "expert" ? 10 : 4)}
              tone="warning"
            />
          ) : null}
          <ArtifactList artifacts={hiveModeComparison ? [hiveModeComparison.outputArtifacts.comparison, hiveModeComparison.outputArtifacts.markdown] : []} connection={connection} />
          {hiveModeCommands.map((entry) => {
            const command = entry.command;
            if (!command) return null;
            return (
              <div className="command-row" key={entry.id}>
                <CodeBlock value={command.command} />
                <ConfirmButton
                  disabled={snapshot.readOnly || busyAction === command.id}
                  message={`Run ${entry.mode.toLowerCase()} Hive export preview locally?`}
                  onConfirm={() => runAction(command.id, () => postJson("/api/runbook/execute", { commandId: command.id }, connection))}
                >
                  Run preview
                </ConfirmButton>
              </div>
            );
          })}
        </Card>
        <Card className="span-6" title="Hive-native bundle">
          <p className="card-subtext">
            No-network Beads, knowledge facts, graph edges, wiki pages, issue context, agent policy, and guarded repair work orders for Hive or a trusted operator.
          </p>
          <KeyValueTable
            rows={[
              ["Status", <Badge key="status" tone={statusTone(snapshot.hiveExport?.status)}>{snapshot.hiveExport?.status ?? "missing"}</Badge>],
              ["Mode", snapshot.hiveExport?.mode ?? "n/a"],
              ["Configured mode", snapshot.hiveExport?.configuredMode ?? "n/a"],
              ["External calls", snapshot.hiveExport?.externalCallsMade ?? 0],
              ["Beads", snapshot.hiveExport?.summary.beads ?? 0],
              ["Knowledge facts", snapshot.hiveExport?.summary.knowledgeFacts ?? 0],
              ["Graph", snapshot.hiveExport ? `${snapshot.hiveExport.summary.graphNodes} nodes / ${snapshot.hiveExport.summary.graphEdges} edges` : "n/a"],
              ["Repair work orders", snapshot.hiveExport?.summary.repairWorkOrders ?? 0]
            ]}
          />
          {snapshot.hiveExport?.blockedReasons?.length ? <FindingList findings={snapshot.hiveExport.blockedReasons} tone="warning" /> : null}
          <ArtifactList artifacts={hiveArtifacts} connection={connection} />
        </Card>
        <Card className="span-6" title="Hive work queue">
          <p className="card-subtext">Beads turn Visual Hive evidence into bounded quality work items for Hive or a trusted maintainer queue.</p>
          {hiveBeads.length ? (
            <SimpleTable
              headers={["Priority", "Actor", "Bead"]}
              rows={hiveBeads.slice(0, hivePreviewLimit).map((bead) => [
                bead.priority,
                bead.actor,
                `${bead.title} (${bead.type}; ${bead.status})`
              ])}
            />
          ) : (
            <EmptyState title="No Beads exported">Run measured or repair-request Hive export mode after evidence exists.</EmptyState>
          )}
        </Card>
        <Card className="span-6" title="Knowledge graph preview">
          <p className="card-subtext">Graph edges connect evidence, facts, Beads, and repair work so agents receive context instead of raw logs.</p>
          {hiveGraphEdges.length ? (
            <SimpleTable
              headers={["Predicate", "From", "To"]}
              rows={hiveGraphEdges.slice(0, hivePreviewLimit).map((edge) => [
                edge.predicate,
                compactGraphId(edge.from),
                compactGraphId(edge.to)
              ])}
            />
          ) : (
            <EmptyState title="No graph edges exported">Measured mode emits graph nodes and edges for Hive-native context.</EmptyState>
          )}
        </Card>
        <Card className="span-6" title="Repair guardrails">
          <p className="card-subtext">Repair work orders are PR-only, bounded, and require a fresh Visual Hive rerun before completion.</p>
          <KeyValueTable
            rows={[
              ["Guarded preview", guardedRepairPreview ? <Badge key="guarded-preview" tone={statusTone(guardedRepairPreview.status)}>{guardedRepairPreview.status}</Badge> : "missing"],
              ["Can request repair", guardedRepairPreview?.readiness.canRequestGuardedRepair ? "yes" : "no"],
              ["External calls", guardedRepairPreview?.externalCallsMade ?? 0],
              ["Ready / blocked work orders", guardedRepairPreview ? `${guardedRepairPreview.summary.readyWorkOrders} / ${guardedRepairPreview.summary.blockedWorkOrders}` : "n/a"],
              ["Repair envelope", repairRequestEnvelope ? <Badge key="repair-envelope" tone={statusTone(repairRequestEnvelope.status)}>{repairRequestEnvelope.status}</Badge> : "missing"],
              ["Trusted repair ready", repairRequestEnvelope?.readiness.canOpenTrustedRepairRequest ? "yes" : "no"],
              [
                "Repair consumer summary",
                trustedRepairConsumerSummary ? <Badge key="repair-consumer" tone={statusTone(trustedRepairConsumerSummary.status)}>{trustedRepairConsumerSummary.status}</Badge> : "missing"
              ],
              ["Trusted consumer ready", trustedRepairConsumerSummary?.readiness.canStartTrustedRepairWorkflow ? "yes" : "no"],
              ["Branches / PRs preview", trustedRepairConsumerSummary ? `${trustedRepairConsumerSummary.summary.branchesToCreate} branches / ${trustedRepairConsumerSummary.summary.pullRequestsToOpen} PRs` : "n/a"],
              [
                "Trusted workflow dry run",
                trustedRepairWorkflowDryRun ? <Badge key="repair-workflow" tone={statusTone(trustedRepairWorkflowDryRun.status)}>{trustedRepairWorkflowDryRun.status}</Badge> : "missing"
              ],
              ["Can run trusted workflow", trustedRepairWorkflowDryRun?.readiness.canRunTrustedRepairWorkflow ? "yes" : "no"],
              ["Planned actions", trustedRepairWorkflowDryRun ? `${trustedRepairWorkflowDryRun.summary.plannedActions} future actions / ${trustedRepairWorkflowDryRun.summary.blockedActions} blocked` : "n/a"],
              ["Required commands", repairRequestEnvelope?.readiness.requiredCommands.slice(0, 2).join("; ") ?? guardedRepairPreview?.readiness.requiredCommands.slice(0, 2).join("; ") ?? "Run visual-hive hive guarded-repair-preview"]
            ]}
          />
          {guardedRepairPreview?.readiness.blockedReasons.length ? (
            <FindingList findings={guardedRepairPreview.readiness.blockedReasons.slice(0, mode === "expert" ? 8 : 3)} tone="warning" />
          ) : null}
          {repairRequestEnvelope?.readiness.blockedReasons.length ? (
            <FindingList findings={repairRequestEnvelope.readiness.blockedReasons.slice(0, mode === "expert" ? 8 : 3)} tone="warning" />
          ) : null}
          {trustedRepairConsumerSummary?.readiness.blockedReasons.length ? (
            <FindingList findings={trustedRepairConsumerSummary.readiness.blockedReasons.slice(0, mode === "expert" ? 8 : 3)} tone="warning" />
          ) : null}
          {trustedRepairWorkflowDryRun?.readiness.blockedReasons.length ? (
            <FindingList findings={trustedRepairWorkflowDryRun.readiness.blockedReasons.slice(0, mode === "expert" ? 8 : 3)} tone="warning" />
          ) : null}
          <ArtifactList
            artifacts={[
              ...(guardedRepairPreview ? [guardedRepairPreview.outputArtifacts.preview, guardedRepairPreview.outputArtifacts.markdown] : []),
              ...(repairRequestEnvelope ? [repairRequestEnvelope.outputArtifacts.envelope, repairRequestEnvelope.outputArtifacts.markdown] : []),
              ...(trustedRepairConsumerSummary ? [trustedRepairConsumerSummary.outputArtifacts.summary, trustedRepairConsumerSummary.outputArtifacts.markdown] : []),
              ...(trustedRepairWorkflowDryRun ? [trustedRepairWorkflowDryRun.outputArtifacts.dryRun, trustedRepairWorkflowDryRun.outputArtifacts.markdown] : [])
            ]}
            connection={connection}
          />
          {trustedRepairWorkflowDryRun?.items.length ? (
            <SimpleTable
              headers={["Future workflow item", "Branch / PR", "Actions"]}
              rows={trustedRepairWorkflowDryRun.items.slice(0, hivePreviewLimit).map((item) => [
                `${item.title} (${item.status})`,
                `${item.branchName} / ${item.pullRequestTitle}`,
                `${item.plannedActions.filter((action) => action.status === "planned").length} planned; ${item.plannedActions.filter((action) => action.status === "blocked").length} blocked`
              ])}
            />
          ) : null}
          {repairOrders.length ? (
            <SimpleTable
              headers={["Work order", "Limits", "Validation"]}
              rows={repairOrders.slice(0, hivePreviewLimit).map((order) => [
                order.title,
                `${order.actor}; attempts=${order.maxAttempts}; humanReview=${order.requireHumanReview}`,
                order.acceptanceCriteria.join("; ")
              ])}
            />
          ) : (
            <EmptyState title="No repair work orders">Repair-request mode emits guarded work orders only when deterministic evidence creates actionable work.</EmptyState>
          )}
          {hiveExport?.agentPolicy ? (
            <KeyValueTable
              rows={[
                ["Verdict authority", hiveExport.agentPolicy.verdictAuthority],
                ["Hive authority", hiveExport.agentPolicy.hiveAuthority],
                ["Final validation", hiveExport.agentPolicy.finalValidation.command],
                ["Forbidden actions", hiveExport.agentPolicy.forbiddenActions.slice(0, 4).join(", ")]
              ]}
            />
          ) : null}
        </Card>
        <Card className="span-6" title="Wiki vault facts">
          <p className="card-subtext">Knowledge facts and wiki pages preserve reusable testing context for future humans and agents.</p>
          {hiveFacts.length ? (
            <SimpleTable
              headers={["Type", "Fact", "Evidence"]}
              rows={hiveFacts.slice(0, hivePreviewLimit).map((fact) => [
                fact.type,
                `${fact.title} (${Math.round(fact.confidence * 100)}% confidence)`,
                fact.relatedEvidenceKeys.join(", ")
              ])}
            />
          ) : (
            <EmptyState title="No knowledge facts exported">Measured mode emits reusable project facts and wiki pages.</EmptyState>
          )}
          <ArtifactList artifacts={wikiArtifacts} connection={connection} />
        </Card>
        <Card className="span-6" title="Next handoff work">
          {blockedReasons.length ? <FindingList findings={blockedReasons} tone="warning" /> : null}
          {workItems.length ? (
            <SimpleTable
              headers={["Priority", "Kind", "Work item"]}
              rows={workItems.slice(0, mode === "expert" ? 8 : 4).map((item) => [item.priority, item.kind, item.title])}
            />
          ) : (
            <EmptyState title="No handoff work items">Generate a handoff packet after evidence exists, or inspect the verdict if no repair work is needed.</EmptyState>
          )}
        </Card>
        {mode === "expert" && (
          <EvidenceDisclosure
            className="span-12"
            title="View raw agent-forward packets"
            data={{
              evidencePacket: snapshot.evidencePacket,
              verdictReport: snapshot.verdictReport,
              handoffPacket: snapshot.handoffPacket,
              hiveExport: snapshot.hiveExport,
              hiveGuardedRepairPreview: snapshot.hiveGuardedRepairPreview,
              hiveRepairRequestEnvelope: snapshot.hiveRepairRequestEnvelope,
              hiveTrustedRepairConsumerSummary: snapshot.hiveTrustedRepairConsumerSummary,
              hiveTrustedRepairWorkflowDryRun: snapshot.hiveTrustedRepairWorkflowDryRun,
              hiveModeComparison: snapshot.hiveModeComparison,
              agentPacket: snapshot.agentPacket,
              pipelineReport: snapshot.pipelineReport
            }}
          />
        )}
      </div>
    </Card>
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

function schemaCatalogFindings(snapshot: Snapshot) {
  const catalog = snapshot.schemaCatalog;
  if (!catalog) {
    return ["No schema catalog verification artifact found. Run `visual-hive schemas verify --output .visual-hive/schema-catalog.json` after schema or evidence-resource changes."];
  }
  const failedChecks = catalog.checks.filter((check) => check.status === "failed");
  if (failedChecks.length) {
    return failedChecks.slice(0, 6).map((check) => `${check.file ?? check.id}: ${check.message}`);
  }
  return [
    `Schema catalog passed with ${catalog.summary.checks} checks across ${catalog.summary.schemasChecked} schemas.`,
    `${catalog.summary.evidenceResources} evidence resources and ${catalog.summary.evidenceReadTools} read tools are catalog-aligned.`
  ];
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
          <ArtifactList
            artifacts={[
              evidenceArtifactPath(snapshot, "triage-report", ".visual-hive/triage.json"),
              evidenceArtifactPath(snapshot, "issue-body", ".visual-hive/issue.md"),
              evidenceArtifactPath(snapshot, "pr-comment", ".visual-hive/pr-comment.md")
            ]}
            connection={connection}
          />
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
      <Card
        className="span-12"
        eyebrow="Review policy"
        title="Baseline queue"
        action={
          <div className="row">
            <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "baseline-review", ".visual-hive/baselines.json"), "file", connection)} label="Open baseline queue" />
            <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "baseline-approvals", ".visual-hive/baseline-approvals.json"), "file", connection)} label="Approvals" />
            <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "baseline-rejections", ".visual-hive/baseline-rejections.json"), "file", connection)} label="Rejections" />
          </div>
        }
      >
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
      <MetricCard className="span-3" label="Visual Hive verdict" tone={verdictTone(snapshot.overview.visualHiveVerdict)} value={snapshot.overview.visualHiveVerdict ?? "missing"} />
      <MetricCard className="span-3" label="Passed contracts" tone="success" value={report?.summary?.passed ?? 0} />
      <MetricCard className="span-3" label="Failed contracts" tone={(report?.summary?.failed ?? 0) > 0 ? "danger" : "success"} value={report?.summary?.failed ?? 0} />
      <MetricCard className="span-3" label="Blocked evidence" tone={snapshot.overview.blockedContributions > 0 ? "warning" : "success"} value={snapshot.overview.blockedContributions} />
      <VerdictContributionPanel className="span-12" snapshot={snapshot} />
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
  const providerRuns = new Map((snapshot.providerRunReport?.providers ?? []).map((provider: any) => [provider.providerId, provider]));
  const providerSummary = {
    enabled: (snapshot.providers ?? []).filter((provider: any) => provider.availability === "enabled").length,
    blocked: (snapshot.providers ?? []).filter((provider: any) => provider.availability === "blocked" || provider.missingEnv?.length).length,
    externalCallsMade: (snapshot.providerRunReport?.providers ?? []).reduce((total: number, provider: any) => total + (provider.normalized?.externalCallsMade ?? 0), 0),
    uploadArtifacts: (snapshot.providerRunReport?.providers ?? []).reduce((total: number, provider: any) => total + (provider.result?.upload?.stagedArtifacts ?? 0), 0)
  };
  return (
    <div className="view-grid">
      <div className="guided-panel span-12">
        <div className="guided-copy">
          <Badge tone={providerSummary.externalCallsMade === 0 ? "success" : "warning"}>{providerSummary.externalCallsMade === 0 ? "no external calls" : "external activity"}</Badge>
          <h3>Provider policy guardrails</h3>
          <p>Provider output is advisory by default. Uploads stay blocked unless a trusted lane explicitly enables credentials, cost policy, gating, and budget authorization.</p>
        </div>
        <div className="guided-actions">
          <div className="next-action secondary">
            <ShieldCheck size={18} />
            <span>
              <strong>Default oracle</strong>
              <small>Visual Hive's verdict comes from deterministic evidence. Playwright remains the local browser runner; providers do not override the verdict by default.</small>
            </span>
            <Badge tone="success">local-first</Badge>
          </div>
          <div className="next-action secondary">
            <ClipboardList size={18} />
            <span>
              <strong>Review before upload</strong>
              <small>{providerSummary.uploadArtifacts} provider artifact(s) are staged or recorded for review; external calls made: {providerSummary.externalCallsMade}.</small>
            </span>
            <Badge tone={providerSummary.uploadArtifacts > 0 ? "warning" : "success"}>{providerSummary.uploadArtifacts > 0 ? "review" : "none"}</Badge>
          </div>
          <div className="next-action secondary">
            <Shield size={18} />
            <span>
              <strong>Provider specialist</strong>
              <small>The provider-specialist packet can inspect provider evidence without upload authority, provider gating authority, or secret access.</small>
            </span>
            <Badge tone={snapshot.providerAgentPacket ? "success" : "warning"}>{snapshot.providerAgentPacket ? "ready" : "missing"}</Badge>
          </div>
        </div>
      </div>
      {(snapshot.providers ?? []).map((provider: any) => {
        const run = providerRuns.get(provider.id) as any;
        const upload = run?.result?.upload;
        return (
          <Card className="span-6" key={provider.id} title={provider.label ?? provider.id} action={<Badge tone={statusTone(run?.result?.status ?? provider.availability)}>{run?.result?.status ?? provider.availability}</Badge>}>
            <KeyValueTable
              rows={[
                ["Role", provider.deterministicRole],
                ["Required env", provider.requiredEnv?.join(", ") || "none"],
                ["Missing env", provider.missingEnv?.join(", ") || "none"],
                ["External calls planned", provider.externalCallsPlanned ?? 0],
                ["Upload allowed", provider.externalUploadAllowed ? "yes" : "no"],
                ["Latest provider result", run?.result?.status ?? "not run"],
                ["Upload status", upload?.status ?? "not run"],
                ["External calls made", run?.normalized?.externalCallsMade ?? 0],
                ["Staged / uploaded", upload ? `${upload.stagedArtifacts} / ${upload.uploadedArtifacts}` : "0 / 0"]
              ]}
            />
            {run?.result?.message && <p className="card-subtext">{safeText(run.result.message)}</p>}
            {upload?.stderr && <CodeBlock value={`Provider stderr\n${upload.stderr}`} />}
            {upload?.manifestPath && <ExternalArtifactLink href={artifactUrl(upload.manifestPath, "file", connection)} label="Open provider upload manifest" />}
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
        );
      })}
      <Card className="span-12" title="Provider specialist packet" action={<Badge tone={snapshot.providerAgentPacket ? "success" : "warning"}>{snapshot.providerAgentPacket ? "ready" : "missing"}</Badge>}>
        <p className="card-subtext">A provider-specialist agent may review Argos/provider evidence, but cannot upload artifacts, enable paid providers, or make provider output authoritative.</p>
        {snapshot.providerAgentPacket ? (
          <>
            <KeyValueTable
              rows={[
                ["Profile", snapshot.providerAgentPacket.profile],
                ["Objective", snapshot.providerAgentPacket.objective],
                ["External network", snapshot.providerAgentPacket.budgets.allowExternalNetwork ? "allowed" : "blocked"],
                ["Max external cost", `$${snapshot.providerAgentPacket.budgets.maxExternalCostUsd}`],
                ["Allowed tools", snapshot.providerAgentPacket.allowedTools.length]
              ]}
            />
            <AgentToolList tools={snapshot.providerAgentPacket.allowedTools} connection={connection} />
            <ArtifactList
              artifacts={[
                evidenceArtifactPath(snapshot, "provider-results", ".visual-hive/provider-results.json"),
                evidenceArtifactPath(snapshot, "provider-upload-argos-manifest", ".visual-hive/provider-upload/argos/manifest.json"),
                evidenceArtifactPath(snapshot, "provider-agent-packet", ".visual-hive/provider-agent-packet.json")
              ]}
              connection={connection}
            />
          </>
        ) : (
          <EmptyState title="No provider packet yet">Run `visual-hive agent-packet --profile provider_specialist --output .visual-hive/provider-agent-packet.json` after provider planning.</EmptyState>
        )}
      </Card>
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
        <ArtifactList
          artifacts={[
            evidenceArtifactPath(snapshot, "triage-prompt", ".visual-hive/triage-prompt.md"),
            evidenceArtifactPath(snapshot, "repair-prompt", ".visual-hive/repair-prompt.md"),
            evidenceArtifactPath(snapshot, "missing-tests", ".visual-hive/missing-tests.md")
          ]}
          connection={connection}
        />
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
        <div className="row">
          <ExternalArtifactLink href={artifactUrl(evidenceArtifactPath(snapshot, "workflow-audit", ".visual-hive/workflows.json"), "file", connection)} label="Open workflow audit" />
        </div>
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

function evidenceArtifact(snapshot: Snapshot, resourceId: string, fallbackPath?: string) {
  const normalizedFallback = fallbackPath?.replaceAll("\\", "/");
  return (snapshot.artifacts ?? []).find((artifact) => {
    const normalizedPath = artifact.path.replaceAll("\\", "/");
    return artifact.evidenceResourceId === resourceId || (Boolean(normalizedFallback) && (normalizedPath === normalizedFallback || normalizedPath.endsWith(`/${normalizedFallback}`)));
  });
}

function evidenceArtifactPath(snapshot: Snapshot, resourceId: string, fallbackPath: string) {
  return evidenceArtifact(snapshot, resourceId, fallbackPath)?.path ?? fallbackPath;
}

function AgentToolList({ tools, connection }: { tools: AgentTool[]; connection?: string }) {
  if (!tools.length) return <EmptyState title="No allowed tools listed" />;
  return (
    <div className="agent-tool-list">
      {tools.map((tool) => (
        <div className="agent-tool-row" key={tool.id}>
          <div>
            <strong>{tool.label}</strong>
            <small>{tool.evidenceResourceTitle ? `${tool.evidenceResourceTitle} · ${tool.evidenceResourceUri}` : tool.reason}</small>
          </div>
          {tool.artifactPath ? <ExternalArtifactLink href={artifactUrl(tool.artifactPath, "file", connection)} label={tool.artifactPath} /> : <Badge tone="neutral">{tool.access}</Badge>}
        </div>
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

function compactGraphId(value: string): string {
  const [, id = value] = value.split(":");
  return id.length > 42 ? `${id.slice(0, 39)}...` : id;
}

function isRenderable(value: unknown): value is ReactElement {
  return isValidElement(value);
}

function verdictContributions(snapshot: Snapshot) {
  if (snapshot.report?.verdictContributions?.length) return snapshot.report.verdictContributions;
  if (snapshot.verdictReport?.allContributions?.length) return snapshot.verdictReport.allContributions;
  return snapshot.evidencePacket?.evidenceContributions ?? [];
}

function formatDate(value?: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function verdictTone(value?: string): Tone {
  if (value === "passed") return "success";
  if (value === "failed") return "danger";
  if (value === "blocked" || value === "warning") return "warning";
  if (value === "inconclusive") return "info";
  return "neutral";
}

function pipelineTone(value?: string): Tone {
  if (value === "passed") return "success";
  if (value === "failed") return "danger";
  if (value === "blocked") return "warning";
  return "neutral";
}

function hiveReadinessTone(value?: string): Tone {
  if (value === "ready") return "success";
  if (value === "trusted_only") return "warning";
  if (value === "blocked") return "danger";
  return "neutral";
}

function hiveCommandIdForMode(mode: string): string {
  if (mode === "repair_request") return "hive-export-repair-request";
  return `hive-export-${mode}`;
}

function trustedRepairReadinessState(snapshot: Snapshot): {
  tone: Tone;
  state: string;
  summary: string;
  primaryAction: string;
  whyItMatters: string;
  actionBadge: string;
  chainSummary: string;
  chainComplete: boolean;
} {
  const chain = [
    { label: "Evidence Packet", ready: Boolean(snapshot.evidencePacket) },
    { label: "Handoff Packet", ready: Boolean(snapshot.handoffPacket) },
    { label: "Hive export", ready: Boolean(snapshot.hiveExport) },
    { label: "Guarded preview", ready: Boolean(snapshot.hiveGuardedRepairPreview) },
    { label: "Repair envelope", ready: Boolean(snapshot.hiveRepairRequestEnvelope) },
    { label: "Trusted consumer", ready: Boolean(snapshot.hiveTrustedRepairConsumerSummary) },
    { label: "Workflow dry run", ready: Boolean(snapshot.hiveTrustedRepairWorkflowDryRun) }
  ];
  const readyCount = chain.filter((item) => item.ready).length;
  const chainComplete = readyCount === chain.length;
  const missing = chain.filter((item) => !item.ready).map((item) => item.label);
  const chainSummary = chainComplete
    ? "All seven evidence artifacts are present: Evidence Packet, Handoff Packet, Hive export, guarded preview, repair envelope, trusted consumer, and workflow dry run."
    : `${readyCount}/${chain.length} artifacts ready. Missing next: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : "."}`;

  const blockedReason =
    snapshot.hiveTrustedRepairWorkflowDryRun?.readiness.blockedReasons[0] ??
    snapshot.hiveTrustedRepairConsumerSummary?.readiness.blockedReasons[0] ??
    snapshot.hiveRepairRequestEnvelope?.readiness.blockedReasons[0] ??
    snapshot.hiveGuardedRepairPreview?.readiness.blockedReasons[0] ??
    snapshot.hiveExport?.blockedReasons?.[0] ??
    snapshot.handoffPacket?.blockedReasons?.[0];

  if (!snapshot.evidencePacket) {
    return {
      tone: "warning",
      state: "not started",
      summary: "Visual Hive has not packaged deterministic evidence for Hive or repair agents yet.",
      primaryAction: "Create the Evidence Packet",
      whyItMatters: "The Evidence Packet is the trusted source that keeps agents grounded in deterministic results instead of raw logs or guesswork.",
      actionBadge: "generate",
      chainSummary,
      chainComplete
    };
  }

  if (!snapshot.handoffPacket || !snapshot.hiveExport) {
    return {
      tone: "warning",
      state: "evidence ready",
      summary: "Deterministic evidence exists, but the Hive handoff bundle is not complete yet.",
      primaryAction: "Run agent handoff review",
      whyItMatters: "This creates sanitized task context, Hive-native work items, and policy evidence without making network calls.",
      actionBadge: "prepare",
      chainSummary,
      chainComplete
    };
  }

  if (!chainComplete) {
    return {
      tone: "warning",
      state: "repair chain incomplete",
      summary: "Hive export exists, but trusted repair readiness still needs the preview, envelope, consumer summary, or workflow dry-run artifacts.",
      primaryAction: "Generate trusted repair previews",
      whyItMatters: "The preview chain makes future repair automation reviewable before any branch, pull request, issue, Hive call, or repair execution can occur.",
      actionBadge: "preview",
      chainSummary,
      chainComplete
    };
  }

  if (snapshot.hiveTrustedRepairWorkflowDryRun?.readiness.canRunTrustedRepairWorkflow) {
    return {
      tone: "success",
      state: "ready for trusted workflow review",
      summary: "The no-network repair chain is complete and can be reviewed as a future trusted workflow plan.",
      primaryAction: "Review trusted workflow dry run",
      whyItMatters: "A maintainer can inspect the planned branch, repair, validation, and PR steps before enabling any real automation.",
      actionBadge: "ready",
      chainSummary,
      chainComplete
    };
  }

  return {
    tone: "warning",
    state: "blocked by policy",
    summary: "The repair chain is complete, but policy still blocks a trusted repair workflow.",
    primaryAction: "Resolve repair policy blockers",
    whyItMatters: blockedReason ?? "Visual Hive keeps guarded repair blocked until the required approvals, commands, and verdict rerun policy are explicit.",
    actionBadge: "blocked",
    chainSummary,
    chainComplete
  };
}

function readHashWorkArea(): WorkAreaId {
  const candidate = window.location.hash.replace(/^#/, "") as WorkAreaId;
  return workAreas.some((area) => area.id === candidate) ? candidate : "start";
}

function readUserMode(): UserMode {
  if (typeof window === "undefined") return "beginner";
  return window.localStorage.getItem("visual-hive-control-plane-mode") === "expert" ? "expert" : "beginner";
}
