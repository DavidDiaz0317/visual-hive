# GitHub Integration

Visual Hive emits GitHub-ready markdown instead of requiring privileged API calls in the default MVP.

Generated artifacts:

- `.visual-hive/report.json`
- `.visual-hive/mutation-report.json`
- `.visual-hive/issue.md`
- `.visual-hive/triage-prompt.md`

Recommended PR permissions:

```yaml
permissions:
  contents: read
```

Issue creation should happen in a trusted follow-up workflow that consumes uploaded artifacts. Do not create issues directly from untrusted PR code with write permissions or secrets.

Use `pull_request`, not `pull_request_target`, for untrusted PR validation.

The GitHub adapter redacts token-like and secret-like values from issue and comment bodies.
