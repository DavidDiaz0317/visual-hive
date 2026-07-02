# Cost Policy

Visual Hive keeps the default path local-first: Playwright runs locally, provider uploads are disabled unless explicitly enabled, and cost reports do not make external calls.

Run:

```bash
visual-hive costs
```

This writes `.visual-hive/costs.json`. The report explains:

- selected contract and target counts
- local screenshot volume
- estimated external screenshot volume
- enabled external providers
- provider credential-name readiness
- cost-policy blocks
- expensive selected targets
- mutation operator volume
- whether any external provider calls were planned or made

The default should remain:

```json
{
  "externalCallsPlanned": 0,
  "externalCallsMade": 0
}
```

External providers are supplemental by default. Argos is the first optional upload adapter and must be invoked explicitly with `visual-hive providers upload --provider argos`; Visual Hive remains the deterministic verdict authority. Disabled, missing-credential, policy-blocked, and dry-run Argos paths record zero external calls, and provider output becomes gating only when explicitly enabled for a trusted lane.

## PR Safety

For pull requests, keep:

```yaml
costPolicy:
  externalUpload:
    pullRequest: false
```

This prevents untrusted PR code from uploading screenshots to paid or external services. Scheduled or manual trusted workflows can use stricter review rules, credentials, and budgets.

## Budgets

Use:

```yaml
costPolicy:
  maxExternalScreenshotsPerRun: 25
  maxMonthlyExternalScreenshots: 5000
  externalUpload:
    onFailureOnly: true
    criticalContractsOnly: true
```

These settings let Visual Hive explain whether a provider upload would be allowed, blocked, or risky before any external network call is made.

For a trusted scheduled/manual Argos lane, raise the screenshot budget only for the trusted workflow and keep PR uploads disabled:

```yaml
providers:
  argos:
    enabled: true
    mode: external
    requiredEnv:
      - ARGOS_TOKEN
    upload:
      includeActualScreenshots: true
      includeDiffScreenshots: true
      includeTextArtifacts: false

costPolicy:
  maxExternalScreenshotsPerRun: 25
  externalUpload:
    pullRequest: false
    schedule: true
    manual: true
    onFailureOnly: true
    criticalContractsOnly: true
```

Validate without network calls first:

```bash
visual-hive providers upload --provider argos --dry-run
```
