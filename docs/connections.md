# Local Repository Connections

`visual-hive connections` manages `.visual-hive/connections.json`, a local-only store of repositories that the Control Plane can show and switch between.

The file stores:

- connection ID and label
- local repository path
- config path inside that repository
- tags

`visual-hive connections list` and the Control Plane inspect those paths at runtime to show readiness status, project name, and latest deterministic status when a report exists.

It does not store credentials, tokens, cookies, provider secrets, kubeconfigs, or LLM keys. Required secrets are still represented by name only in target/provider audits.

Example:

```bash
visual-hive connections add --repo ../console --id kubestellar-console --label "KubeStellar Console" --tag dogfood
visual-hive connections list
```

The Control Plane `Connections` page reads and can manage the same store in write mode. It can add a local repo path, optional config path, stable ID, label, and tags, then switch only to stored ready connection IDs. Removing a connection deletes only the local connection record; it does not delete the target repository or any Visual Hive artifacts inside that repository.

`visual-hive ui --read-only` disables connection add/remove actions. Switching repositories still uses a connection ID already present in `.visual-hive/connections.json`; the browser cannot switch to arbitrary paths.

Schema: `schemas/visual-hive.connections.schema.json`.
