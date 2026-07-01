import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main data-testid="consumer-dashboard" className="shell">
      <header className="topbar" data-testid="consumer-header">
        <div>
          <p className="eyebrow">Visual Hive consumer fixture</p>
          <h1>Release Health</h1>
        </div>
        <button data-testid="critical-action-button">Promote build</button>
      </header>
      <section className="grid" data-testid="dashboard-grid">
        <article className="metric-card" data-testid="dashboard-card">
          <span>Visual contracts</span>
          <strong>4</strong>
        </article>
        <article className="metric-card" data-testid="dashboard-card">
          <span>Mutation score</span>
          <strong>75%</strong>
        </article>
        <article className="metric-card" data-testid="dashboard-card">
          <span>Provider uploads</span>
          <strong>off</strong>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
