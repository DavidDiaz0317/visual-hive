import { useEffect, useMemo, useState } from "react";

interface DashboardItem {
  label: string;
  value: string;
  trend: string;
}

interface DashboardData {
  message: string;
  items: DashboardItem[];
}

const fallbackData: DashboardData = {
  message: "Demo metrics loaded",
  items: [
    { label: "Contracts", value: "18", trend: "+4" },
    { label: "Routes", value: "7", trend: "+2" },
    { label: "Mutation score", value: "83%", trend: "+9" }
  ]
};

export function App() {
  const params = new URLSearchParams(window.location.search);
  const forcedMutation = window.localStorage.getItem("visual-hive-mutation");
  const showLogin = params.get("login") === "true" || forcedMutation === "force-login-on-demo";
  const [data, setData] = useState<DashboardData | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard-data")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API status ${response.status}`);
        }
        return (await response.json()) as DashboardData;
      })
      .then((nextData) => {
        if (!cancelled) {
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
  }, []);

  const visibleData = useMemo(() => data ?? fallbackData, [data]);

  if (showLogin) {
    return (
      <main className="login-page" data-testid="login-page">
        <section className="login-panel">
          <h1>Visual Hive Demo Login</h1>
          <p>This route is intentionally not allowed in public demo mode.</p>
          <button data-testid="github-login-button">Continue with GitHub</button>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-page" data-testid="dashboard-page">
      <header className="topbar">
        <div>
          <p className="caption">Visual Hive demo mode</p>
          <h1>Dashboard quality surface</h1>
        </div>
        <button className="critical-action" data-testid="critical-action-button">
          Run protected check
        </button>
      </header>

      <section className="data-status" aria-live="polite">
        <strong>{error ? "API data unavailable" : visibleData.message}</strong>
        <span>{error ? error : "Public demo target is rendering deterministic fixture data."}</span>
      </section>

      <section className="card-grid" aria-label="Demo dashboard cards">
        {visibleData.items.map((item) => (
          <article className="dashboard-card" data-testid="dashboard-card" key={item.label}>
            <span className="demo-badge" data-testid="demo-badge">
              Demo
            </span>
            <h2>{item.label}</h2>
            <p className="metric">{item.value}</p>
            <p className="trend">{item.trend} this week</p>
          </article>
        ))}
      </section>
    </main>
  );
}
