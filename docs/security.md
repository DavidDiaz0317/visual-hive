# Security And Supply Chain

Visual Hive is secure by default: deterministic Playwright contracts remain the pass/fail oracle, PR workflows should be read-only and secret-free, protected targets run only in trusted lanes, and LLM/provider integrations are disabled or advisory unless explicitly governed.

## Security audit command

Run:

```bash
visual-hive security
```

This writes `.visual-hive/security.json`. The default audit is local and offline. It checks:

- GitHub workflow safety if `.github/workflows` exists
- `pull_request_target` risk
- PR secret and write-permission usage
- protected target posture
- provider external upload policy
- LLM governance posture
- whether npm audit evidence was supplied

It does not call paid providers, upload screenshots, call an LLM, or run `npm audit` unless explicitly requested.

## npm audit evidence

For deterministic local/demo runs, dependency audit is reported as `not_run`.

To include supply-chain evidence from a trusted environment:

```bash
npm audit --json > npm-audit.json
visual-hive security --audit-json npm-audit.json
```

Or run directly:

```bash
visual-hive security --npm-audit
```

Use the direct mode only where network access and npm registry calls are acceptable.

## Workflow rules

- PR validation uses `pull_request`, not `pull_request_target`.
- PR validation uses `contents: read`.
- PR validation does not use secrets.
- PR validation uploads `.visual-hive` artifacts with `include-hidden-files: true`.
- Trusted issue creation uses `workflow_run`, downloads artifacts, redacts again, and does not checkout or execute PR code.

## Provider and LLM rules

- Playwright is the default deterministic oracle.
- External visual providers are optional supplemental adapters.
- External uploads stay disabled on PRs unless explicitly reviewed.
- LLM prompts are advisory artifacts by default.
- LLM output never decides pass/fail.
- Provider and LLM governance decisions record `externalCallsMade: 0`.

## Secret handling

Visual Hive reports required secret names, not values. Sanitization redacts common secret-like keys and headers including token, access_token, id_token, refresh_token, password, secret, key, code, authorization, bearer, cookie, set-cookie, and client_secret.
