### Added

- Manage runtimes, GitHub, Jira, usage metrics, skills and secrets in one searchable Integrations screen, with status and Connect or Disconnect on each row.

<!-- detail -->

- One **Integrations** screen (Menu → Integrations) lists runtimes, GitHub,
  Jira, usage metrics, agent skills and the vault, each with what it gives
  World, its state (connected, available, needs connect, error) and one
  Connect or Disconnect. **All**, one tab per kind and a **Vault** tab, with
  counts, and one search that always covers everything keep it usable at
  dozens of integrations; `?integrationsFixture`
  previews that size. Elements missing a source offer **Connect**, which
  opens it at that row. The registry is read-only at
  `GET /api/world/integrations`.

### Changed

- The separate Sources and OTEL economy metrics menu entries are replaced by Integrations. Tokens go through one vault; the existing Jira token file is still read.
