const links = {
  github: "https://github.com/DavidDiaz0317/visual-hive",
  demoSite: "https://github.com/DavidDiaz0317/visual-hive-demo-site",
  issueSix: "https://github.com/DavidDiaz0317/visual-hive-demo-site/issues/6",
  docs: "https://github.com/DavidDiaz0317/visual-hive/tree/main/docs",
  githubApp: "https://github.com/DavidDiaz0317/visual-hive/blob/main/docs/github-app.md",
  mcp: "https://github.com/DavidDiaz0317/visual-hive/blob/main/docs/mcp.md",
  controlPlane: "https://github.com/DavidDiaz0317/visual-hive/blob/main/docs/control-plane.md",
  hive: "https://github.com/kubestellar/hive"
};

const proofCards = [
  {
    title: "External demo-site",
    status: "Client proof",
    text: "The separate visual-hive-demo-site repo runs Visual Hive through consumer-facing vh:* commands."
  },
  {
    title: "Issue #6 lifecycle",
    status: "Trusted proof",
    text: "A real GitHub issue was created or updated from sanitized Visual Hive evidence and deduped by fingerprint."
  },
  {
    title: "MCP context",
    status: "Read-only",
    text: "Agents can read issue, graph, evidence, artifact, and validation context without getting write tools by default."
  },
  {
    title: "GitHub App MVP",
    status: "Local/server",
    text: "The app can process mock and trusted artifact events, while live API calls remain explicitly guarded."
  }
];

const steps = [
  "Repo analysis",
  "Visual Graph",
  "Deterministic checks",
  "Mutation adequacy",
  "Evidence Packet",
  "Issue queue",
  "Agents or Hive",
  "Rerun validation"
];

const installSteps = [
  {
    label: "1",
    title: "Start local",
    command: "npm run demo:full-run",
    text: "Use the CLI and local Playwright path first. No paid provider or hosted service is required."
  },
  {
    label: "2",
    title: "Add config",
    command: "visual-hive init",
    text: "Define targets, contracts, visual thresholds, mutation operators, and PR-safe lanes."
  },
  {
    label: "3",
    title: "Enable CI",
    command: "visual-hive plan && visual-hive run --ci",
    text: "Run deterministic checks in read-only pull request workflows and upload artifacts."
  },
  {
    label: "4",
    title: "Route issues",
    command: "visual-hive issues publish --dry-run",
    text: "Trusted workflows or the GitHub App can publish sanitized issue candidates when explicitly enabled."
  }
];

const safetyItems = [
  "PR workflows are read-only and secret-free.",
  "Local/default runs create zero real GitHub issues.",
  "LLMs, Hive, MCP clients, and providers do not decide pass/fail.",
  "Visual Hive does not auto-repair, auto-open PRs, or auto-approve baselines.",
  "Hosted providers and live publishing are opt-in trusted lanes."
];

export function App() {
  return (
    <main>
      <Header />
      <section className="hero section-pad" id="product">
        <div className="hero-copy">
          <p className="section-label">Visual Hive</p>
          <h1>Issue-centric visual QA for AI-maintained repos</h1>
          <p className="hero-lede">
            Detect, prove, package, route, and validate UI quality issues with deterministic evidence. Visual Hive keeps
            Playwright local-first while making the final verdict, issue handoff, MCP context, and agent loop explicit.
          </p>
          <div className="hero-actions" aria-label="Primary links">
            <a className="button primary" href={links.github}>
              View GitHub
            </a>
            <a className="button secondary" href="#run-demo">
              Run the demo
            </a>
            <a className="button tertiary" href={links.demoSite}>
              See demo-site
            </a>
          </div>
        </div>
        <div className="hero-panel" aria-label="Visual Hive status summary">
          <div className="panel-header">
            <span className="signal" />
            <span>Current product surface</span>
          </div>
          <div className="verdict-card">
            <span>Visual Hive verdict layer</span>
            <strong>Deterministic authority</strong>
          </div>
          <div className="metric-grid">
            <div>
              <strong>0</strong>
              <span>default live issue calls</span>
            </div>
            <div>
              <strong>MCP</strong>
              <span>read-only by default</span>
            </div>
            <div>
              <strong>PR</strong>
              <span>no secrets, no writes</span>
            </div>
            <div>
              <strong>Hive</strong>
              <span>handoff, not oracle</span>
            </div>
          </div>
        </div>
      </section>

      <section className="loop section-pad" id="how-it-works">
        <div className="section-heading">
          <p className="section-label">How it works</p>
          <h2>From repository evidence to durable issues</h2>
          <p>
            Visual Hive converts visual and user-flow risk into a structured loop that humans, Hive, Codex, or other
            agents can act on without taking pass/fail authority away from deterministic validation.
          </p>
        </div>
        <div className="loop-rail">
          {steps.map((step, index) => (
            <div className="loop-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
        <img className="diagram" src="/assets/visual-hive-issue-loop.svg" alt="Visual Hive issue-centric loop diagram" />
      </section>

      <section className="proof section-pad" id="proof">
        <div className="section-heading compact">
          <p className="section-label">Proof, not claims</p>
          <h2>Built around artifacts reviewers can inspect</h2>
        </div>
        <div className="proof-grid">
          {proofCards.map((card) => (
            <article className="proof-card" key={card.title}>
              <span>{card.status}</span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split section-pad" id="run-demo">
        <div>
          <p className="section-label">Get started</p>
          <h2>Install locally first. Connect automation after evidence is stable.</h2>
          <p>
            The recommended path starts with CLI evidence and PR-safe workflows. Hosted GitHub App onboarding and live
            issue publishing are production directions, not requirements for local adoption.
          </p>
          <a className="button primary" href={links.docs}>
            Read the docs
          </a>
        </div>
        <div className="install-list">
          {installSteps.map((step) => (
            <article className="install-step" key={step.title}>
              <span>{step.label}</span>
              <div>
                <h3>{step.title}</h3>
                <code>{step.command}</code>
                <p>{step.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="assets section-pad" id="docs">
        <div className="asset-card wide">
          <div>
            <p className="section-label">Visual Graph</p>
            <h2>Agents get a bounded map instead of vague repo-wide prompts</h2>
            <p>
              The Visual Graph links files, components, routes, selectors, contracts, screenshots, mutations, issues,
              artifacts, and agent profiles so follow-up work can start from affected surfaces.
            </p>
          </div>
          <img src="/assets/visual-graph-chain.svg" alt="Visual Graph relationship chain" />
        </div>
        <div className="asset-pair">
          <div className="asset-card">
            <h3>MCP issue context</h3>
            <p>Read-only MCP resources expose issue and evidence context without giving agents default write tools.</p>
            <img src="/assets/visual-hive-mcp-issue-model.svg" alt="Visual Hive MCP issue model" />
          </div>
          <div className="asset-card">
            <h3>Safety boundary</h3>
            <p>Visual Hive packages and validates. Humans, Hive, or agents may act under explicit governance.</p>
            <img src="/assets/visual-hive-boundaries.svg" alt="Visual Hive safety boundaries" />
          </div>
        </div>
      </section>

      <section className="safety section-pad" id="safety">
        <div className="section-heading compact">
          <p className="section-label">Safety model</p>
          <h2>Default behavior is conservative</h2>
        </div>
        <ul className="safety-list">
          {safetyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="links section-pad" id="links">
        <div className="section-heading compact">
          <p className="section-label">References</p>
          <h2>Follow the implementation</h2>
        </div>
        <div className="link-grid">
          <a href={links.github}>Product repo</a>
          <a href={links.demoSite}>External demo-site</a>
          <a href={links.issueSix}>Issue #6 proof</a>
          <a href={links.githubApp}>GitHub App docs</a>
          <a href={links.mcp}>MCP docs</a>
          <a href={links.controlPlane}>Control Plane docs</a>
          <a href={links.hive}>KubeStellar Hive</a>
        </div>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#product" aria-label="Visual Hive home">
        <span className="brand-mark">VH</span>
        <span>Visual Hive</span>
      </a>
      <nav aria-label="Site navigation">
        <a href="#product">Product</a>
        <a href="#how-it-works">How it works</a>
        <a href="#proof">Proof</a>
        <a href="#safety">Safety</a>
      </nav>
      <a className="header-link" href={links.github}>
        GitHub
      </a>
    </header>
  );
}
