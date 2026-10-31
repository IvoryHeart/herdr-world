### Added

- Preserve the provenance of agent status, session and pull request link observations
  in backend read models. Conflicting reports coexist, source outages retain their
  evidence, and action authority keeps its existing fresh source checks.

### Fixed

- Retire earlier transcript claims when a Codex title names a new thread, and keep
  runtime replacement from borrowing a previous terminal's session or checkout.
- Retain PR-link evidence omitted from a successful truncated GitHub page, while
  retiring claims when their runtime or connection ends.
