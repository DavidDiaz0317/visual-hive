# Install And Usage

## Local Development

```bash
npm install
npm run build
node packages/cli/dist/index.js --help
```

Run the demo acceptance path:

```bash
npm run demo:all
npm run demo:ci
npm run smoke:cli
```

The demo flow writes plan, report, mutation, coverage, target audit, contract audit, schedule audit, workflow-safety, no-network provider adapter results, triage, LLM-governance, issue, PR-comment, run history, and artifact-index outputs under `examples/demo-react-app/.visual-hive`.

## Future npm Package Path

The root workspace stays private. Publishable packages are prepared under `packages/`, with `@visual-hive/cli` exposing the `visual-hive` binary.

Future consumers should install the CLI package once it is published:

```bash
npm install --save-dev @visual-hive/cli
npx visual-hive recommend
npx visual-hive recommend --write-config
npx visual-hive init
```

`visual-hive recommend` is the safest first command in a target repo: it writes `.visual-hive/recommendations.json` after inspecting package scripts, framework dependencies, and `data-testid` selectors. `--write-config` creates `visual-hive.config.yaml` from that recommendation and refuses to overwrite an existing config unless `--force` is passed.

## GitHub Action Templates

Workflow templates live in `templates/github-actions/`. Use the PR workflow for untrusted pull requests, the scheduled workflow for protected targets, and the trusted failure-issue workflow to create issues from uploaded sanitized artifacts.

## Monorepo Targets

Use `command` targets for one frontend preview process. Use `commandGroup` for fake OAuth or fullstack test rigs with multiple local services. Use `protected` for scheduled/manual environments that require secrets.
