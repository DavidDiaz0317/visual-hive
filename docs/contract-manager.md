# Contract Manager

`visual-hive contracts` writes `.visual-hive/contracts.json`, a config/report-based audit of every contract.

It records:

- contract ID, description, target, severity, and run modes
- wait selectors, selector assertions, text assertions, screenshots, routes, and viewports
- console error handling rules
- latest deterministic status when `report.json` exists
- selected/not-selected state from the latest plan or an in-memory plan
- mutation operator mappings and latest mutation results
- changed-file selection rules that reference the contract
- gaps and recommendations

Example:

```bash
visual-hive plan --mode pr --changed-files changed-files.txt
visual-hive run --ci
visual-hive mutate
visual-hive contracts --changed-files changed-files.txt
```

The artifact schema is tracked at `schemas/visual-hive.contracts.schema.json`. The Control Plane Contract Manager page reads the same core audit model as the CLI.
