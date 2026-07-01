import { useEffect, useMemo, useState } from "react";

interface DashboardItem {
  label: string;
  value: string;
  trend: string;
  tone: "good" | "watch" | "risk";
}

interface TargetLane {
  name: string;
  target: string;
  status: "passing" | "watching" | "blocked";
  cadence: string;
  screenshots: number;
}

interface RunStage {
  name: string;
  duration: string;
  status: "passed" | "created" | "review";
}

interface CoverageArea {
  name: string;
  desktop: "covered" | "partial" | "gap";
  mobile: "covered" | "partial" | "gap";
  risk: "low" | "medium" | "high";
}

interface ArtifactItem {
  name: string;
  type: "screenshot" | "json" | "prompt";
  detail: string;
}

interface DashboardData {
  message: string;
  items: DashboardItem[];
  lanes: TargetLane[];
  stages: RunStage[];
  coverage: CoverageArea[];
  artifacts: ArtifactItem[];
}

const fallbackData: DashboardData = {
  message: "Demo metrics loaded",
  items: [
    { label: "Contracts", value: "18", trend: "+4", tone: "good" },
    { label: "Routes", value: "7", trend: "+2", tone: "good" },
    { label: "Mutation score", value: "83%", trend: "+9", tone: "watch" },
    { label: "Visual diffs", value: "0", trend: "stable", tone: "good" }
  ],
  lanes: [
    { name: "PR local preview", target: "localPreview", status: "passing", cadence: "Every pull request", screenshots: 4 },
    { name: "Canary sweep", target: "localPreview", status: "watching", cadence: "15 minute schedule", screenshots: 2 },
    { name: "Protected hosted lane", target: "unsafeHosted", status: "blocked", cadence: "Requires secrets", screenshots: 0 }
  ],
  stages: [
    { name: "Plan", duration: "0.4s", status: "passed" },
    { name: "Contracts", duration: "3.2s", status: "passed" },
    { name: "Screenshots", duration: "2.8s", status: "created" },
    { name: "Triage", duration: "0.7s", status: "review" }
  ],
  coverage: [
    { name: "Dashboard shell", desktop: "covered", mobile: "covered", risk: "low" },
    { name: "API fallback", desktop: "covered", mobile: "partial", risk: "medium" },
    { name: "Auth boundary", desktop: "covered", mobile: "covered", risk: "high" },
    { name: "Visual assets", desktop: "covered", mobile: "covered", risk: "medium" }
  ],
  artifacts: [
    { name: "dashboard-desktop", type: "screenshot", detail: "1440 x 900 baseline" },
    { name: "dashboard-mobile", type: "screenshot", detail: "390 x 844 baseline" },
    { name: "report.json", type: "json", detail: "Deterministic run output" },
    { name: "llm-triage.md", type: "prompt", detail: "Offline advisory context" }
  ]
};

const seededIssues = [
  {
    id: "api-500",
    label: "API outage",
    description: "Shows the alert surface used to verify error-state contracts."
  },
  {
    id: "empty-data",
    label: "Empty data",
    description: "Drops records so card and coverage selectors expose missing content."
  },
  {
    id: "mobile-overflow",
    label: "Mobile overflow",
    description: "Adds a wide diagnostic row for responsive screenshot checks."
  },
  {
    id: "broken-image",
    label: "Broken asset",
    description: "Points the preview image at a missing file for visual detection."
  },
  {
    id: "route-guard-bypass",
    label: "Guard bypass",
    description: "Exposes protected controls that public demo contracts forbid."
  }
] as const;

type SeededIssue = (typeof seededIssues)[number]["id"] | "force-login-on-demo" | "stale-loading-state" | "hidden-error-banner" | "removed-accessible-name" | "theme-token-drift";

function hasSeededIssue(value: string, issue: SeededIssue): boolean {
  return value === issue;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const forcedMutation = window.localStorage.getItem("visual-hive-mutation") ?? "";
  const seededIssue = params.get("issue") ?? forcedMutation;
  const showLogin = params.get("login") === "true" || hasSeededIssue(seededIssue, "force-login-on-demo");
  const [data, setData] = useState<DashboardData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [checkState, setCheckState] = useState<"idle" | "passed">("idle");

  useEffect(() => {
    let cancelled = false;

    if (hasSeededIssue(seededIssue, "api-500")) {
      setError("Seeded API 500 state for contract triage.");
      setData(undefined);
      return () => {
        cancelled = true;
      };
    }

    if (hasSeededIssue(seededIssue, "empty-data")) {
      setError(undefined);
      setData({ ...fallbackData, message: "Seeded empty data state", items: [] });
      return () => {
        cancelled = true;
      };
    }

    fetch("/api/dashboard-data")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API status ${response.status}`);
        }
        return (await response.json()) as DashboardData;
      })
      .then((nextData) => {
        if (!cancelled) {
          setError(undefined);
          setData(nextData);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load dashboard data");
          setData(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [seededIssue]);

  const visibleData = useMemo(() => data ?? fallbackData, [data]);
  const previewSrc = hasSeededIssue(seededIssue, "broken-image") ? "/missing-visual-hive-preview.svg" : "/dashboard-preview.svg";
  const visibleItems = visibleData.items;

  if (showLogin) {
    return (
      <main className="login-page" data-testid="login-page">
        <section className="login-panel">
          <p className="caption">Blocked public surface</p>
          <h1>Visual Hive Demo Login</h1>
          <p>This route is intentionally not allowed in public demo mode.</p>
          <button data-testid="github-login-button">Continue with GitHub</button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`dashboard-page ${hasSeededIssue(seededIssue, "mobile-overflow") ? "has-mobile-overflow" : ""}`}
      data-testid="dashboard-page"
    >
      <header className="topbar">
        <div>
          <p className="caption">Visual Hive demo mode</p>
          <h1>Dashboard quality surface</h1>
          <p className="intro">
            A deterministic fixture for contract selection, visual diffs, mutation adequacy, API fallbacks, and offline
            triage artifacts.
          </p>
        </div>
        <button
          className="critical-action"
          data-testid="critical-action-button"
          aria-label="Run protected check"
          onClick={() => setCheckState("passed")}
        >
          Run protected check
        </button>
      </header>

      <section className="data-status" aria-live="polite">
        <div>
          <strong>{error ? "API data unavailable" : visibleData.message}</strong>
          <span>{error ? error : "Public demo target is rendering deterministic fixture data."}</span>
        </div>
        <p className="check-result" data-testid="protected-check-result">
          {checkState === "passed" ? "Protected check passed without exposing login controls." : "Protected check idle"}
        </p>
      </section>

      {error ? (
        <section className="error-banner" data-testid="error-banner" role="alert">
          <strong>Error state visible</strong>
          <span>Contracts can require this banner so hidden alert regressions are caught.</span>
        </section>
      ) : null}

      {hasSeededIssue(seededIssue, "route-guard-bypass") ? (
        <section className="protected-route" data-testid="protected-route" role="region" aria-label="Protected route bypass">
          <h2>Protected route bypass</h2>
          <p>Cluster administration controls are visible without the expected guard.</p>
        </section>
      ) : null}

      {hasSeededIssue(seededIssue, "stale-loading-state") ? (
        <section className="loading-state" data-testid="loading-state" role="status" aria-busy="true">
          Loading dashboard data
        </section>
      ) : null}

      <section className="hero-grid" aria-label="Demo overview">
        <div className="summary-panel">
          <div className="summary-copy">
            <p className="caption">Current run</p>
            <h2>Local-first visual QA, with useful failure modes ready to inspect.</h2>
            <p>
              The page keeps normal runs stable while giving Visual Hive enough structure to explain what was selected,
              what changed, and which deterministic signals failed.
            </p>
          </div>
          <img
            className="dashboard-preview"
            data-testid="dashboard-preview-image"
            src={previewSrc}
            alt="Visual Hive dashboard preview showing contract, screenshot, and triage panels"
          />
        </div>

        <aside className="issue-panel" aria-label="Seeded issue states">
          <p className="caption">Seeded issue states</p>
          <div className="issue-list">
            {seededIssues.map((issue) => (
              <a
                className={seededIssue === issue.id ? "issue-link active" : "issue-link"}
                data-testid={`seeded-issue-${issue.id}`}
                href={`/?issue=${issue.id}`}
                key={issue.id}
              >
                <span>{issue.label}</span>
                <small>{issue.description}</small>
              </a>
            ))}
          </div>
        </aside>
      </section>

      <section className="card-grid" aria-label="Demo dashboard cards">
        {visibleItems.length > 0 ? (
          visibleItems.map((item) => (
            <article className={`dashboard-card ${item.tone}`} data-testid="dashboard-card" key={item.label}>
              <span className="demo-badge" data-testid="demo-badge">
                Demo
              </span>
              <h2>{item.label}</h2>
              <p className="metric">{item.value}</p>
              <p className="trend">{item.trend} this week</p>
            </article>
          ))
        ) : (
          <article className="empty-state" data-testid="empty-data-state">
            <h2>No dashboard records</h2>
            <p>This seeded state should be caught by card selectors and visual baselines.</p>
          </article>
        )}
      </section>

      <section className="insight-grid" aria-label="Run detail panels">
        <article className="detail-panel">
          <div className="panel-header">
            <p className="caption">Targets</p>
            <h2>Lane health</h2>
          </div>
          <div className="lane-list" data-testid="target-lane-list">
            {visibleData.lanes.map((lane) => (
              <div className="lane-row" key={lane.target}>
                <span className={`status-dot ${lane.status}`} aria-hidden="true" />
                <div>
                  <strong>{lane.name}</strong>
                  <span>
                    {lane.target} - {lane.cadence}
                  </span>
                </div>
                <b>{lane.screenshots}</b>
              </div>
            ))}
          </div>
        </article>

        <article className="detail-panel">
          <div className="panel-header">
            <p className="caption">Runtime</p>
            <h2>Last deterministic pass</h2>
          </div>
          <ol className="run-timeline" data-testid="run-timeline">
            {visibleData.stages.map((stage) => (
              <li className={stage.status} key={stage.name}>
                <span>{stage.name}</span>
                <strong>{stage.duration}</strong>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="coverage-panel" data-testid="coverage-matrix" aria-label="Coverage matrix">
        <div className="panel-header">
          <p className="caption">Coverage</p>
          <h2>Viewport and risk matrix</h2>
        </div>
        <div className="coverage-table" role="table" aria-label="Viewport coverage matrix">
          <div className="coverage-row heading" role="row">
            <span role="columnheader">Area</span>
            <span role="columnheader">Desktop</span>
            <span role="columnheader">Mobile</span>
            <span role="columnheader">Risk</span>
          </div>
          {visibleData.coverage.map((area) => (
            <div className="coverage-row" role="row" key={area.name}>
              <strong role="cell">{area.name}</strong>
              <span className={`pill ${area.desktop}`} role="cell">
                {area.desktop}
              </span>
              <span className={`pill ${area.mobile}`} role="cell">
                {area.mobile}
              </span>
              <span className={`risk ${area.risk}`} role="cell">
                {area.risk}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-strip" aria-label="Generated artifacts">
        {visibleData.artifacts.map((artifact) => (
          <article className="artifact-card" data-testid="artifact-card" key={artifact.name}>
            <span>{artifact.type}</span>
            <strong>{artifact.name}</strong>
            <p>{artifact.detail}</p>
          </article>
        ))}
      </section>

      {hasSeededIssue(seededIssue, "mobile-overflow") ? (
        <section className="overflow-probe" data-testid="mobile-overflow-probe">
          This intentionally wide probe demonstrates mobile overflow detection in visual screenshots.
        </section>
      ) : null}
    </main>
  );
}
