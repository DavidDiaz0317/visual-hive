# Visual Hive Demo React App

This app is a deterministic fixture for Visual Hive. It exposes dashboard, login, demo badge, API-driven data, and critical-action surfaces with stable `data-testid` attributes.

Run it locally:

```bash
npm install
npm run build
npm run preview -- --port 4173
```

From the repo root:

```bash
node packages/cli/dist/index.js doctor --config examples/demo-react-app/visual-hive.config.yaml
node packages/cli/dist/index.js plan --config examples/demo-react-app/visual-hive.config.yaml --mode pr --changed-files examples/demo-react-app/changed-files.txt
```
