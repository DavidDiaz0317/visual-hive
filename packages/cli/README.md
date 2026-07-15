# @visual-hive/cli

Command-line interface for Visual Hive.

`visual-hive capabilities` writes the machine-verifiable public-surface receipt documented in [Capability parity](https://github.com/DavidDiaz0317/visual-hive/blob/main/docs/capability-parity.md). The end-to-end pipeline runs this gate before its final complete artifact-index refresh.

Local development:

```bash
npm install
npm run build
node packages/cli/dist/index.js --help
```

The package exposes the `visual-hive` binary and ESM exports from `dist`.

Useful local commands:

```bash
node packages/cli/dist/index.js doctor --config examples/demo-react-app/visual-hive.config.yaml
node packages/cli/dist/index.js plan --config examples/demo-react-app/visual-hive.config.yaml --mode pr --changed-files examples/demo-react-app/changed-files.txt
node packages/cli/dist/index.js run --config examples/demo-react-app/visual-hive.config.yaml --skip-install --skip-build
node packages/cli/dist/index.js recommend --repo examples/demo-react-app --profile hosted-review
node packages/cli/dist/index.js recommend --repo examples/demo-react-app --write-docs
node packages/cli/dist/index.js recommend --repo examples/demo-react-app --write-setup-bundle
node packages/cli/dist/index.js triage --config examples/demo-react-app/visual-hive.config.yaml
node packages/cli/dist/index.js llm --config examples/demo-react-app/visual-hive.config.yaml
```

`visual-hive llm` is prompt-only governance. It reads generated prompt artifacts, estimates token/cost budgets, writes `.visual-hive/llm-usage.json`, and never calls an external model.
