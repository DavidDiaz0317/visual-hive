# Visual Hive Demo React App

This app is a deterministic fixture for Visual Hive. It exposes dashboard, login, demo badge, API-driven data, image, coverage matrix, target lane, artifact, and critical-action surfaces with stable `data-testid` attributes.

Run it locally:

```bash
npm install
npm run build
npm run preview -- --port 4173 --strictPort
```

Seeded issue routes are opt-in and keep the default `/` route stable:

```bash
http://127.0.0.1:4173/?issue=api-500
http://127.0.0.1:4173/?issue=empty-data
http://127.0.0.1:4173/?issue=mobile-overflow
http://127.0.0.1:4173/?issue=broken-image
http://127.0.0.1:4173/?issue=route-guard-bypass
```

The Visual Hive config also exercises `/?issue=api-500` in the `dashboard-visual-stability` contract so hidden alert mutations can be detected without requiring a paid visual provider.

From the repo root:

```bash
node packages/cli/dist/index.js doctor --config examples/demo-react-app/visual-hive.config.yaml
node packages/cli/dist/index.js plan --config examples/demo-react-app/visual-hive.config.yaml --mode pr --changed-files examples/demo-react-app/changed-files.txt
```
