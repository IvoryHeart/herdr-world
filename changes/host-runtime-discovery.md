### Added

- Group runtime connections under local or SSH hosts, discover all integrated runtimes on connect or request, and retain empty hosts with installation choices.
- Expose host and runtime status in aggregate snapshots, Integrations and the CLI, preserving existing runtime IDs, generations and per-connection API arrays.

### Fixed

- Preserve per-runtime auto-connect and explicit disconnect intent across host discovery, and isolate startup from another host's catalogue-write failure.
