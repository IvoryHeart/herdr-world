### Added

- Add herdr-core connections: **Hosts → Manage connections → Add herdr-core**
  watches a running herdr-core on this computer or a Unix SSH host. World reads
  core's `core.lock` on every connect and never starts a core. A connection
  shows its live terminals, turns stale when core stops, and shows the same
  terminals at the same addresses when core is back. Open World with
  `?coreFixture` to try it with a stand-in core.
