### Added

- One **Integrations** screen (Menu → Integrations) lists runtimes, GitHub,
  Jira, usage metrics, agent skills and the vault, each with what it gives
  World, its state (connected, available, needs connect, error) and one
  Connect or Disconnect. One tab per kind, with counts, and one search across
  them keep it usable at dozens of integrations; `?integrationsFixture`
  previews that size. Elements missing a source offer **Connect**, which
  opens it at that row. The registry is read-only at
  `GET /api/world/integrations`.

### Changed

- The separate Sources and OTEL economy metrics menu entries are replaced by
  Integrations. Tokens go through one vault; the existing Jira token file is
  still read.
