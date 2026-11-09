### Added

- Menu → Configuration → Integrations shows World's skill under each Herdr
  harness on World's own host: state, path, and Install, Update or Uninstall
  buttons that run the same installer as `herdr-world integration`.
  Uninstalling the file Codex, Pi and Kimi share names the harnesses that
  lose it before it runs.

### Fixed

- Configuration → Integrations reloads by itself after World restarts or a
  connection's Herdr runtime changes, instead of saying the host is no longer
  available. It suggests updating Herdr only when Herdr refuses the
  integration methods.
- Configuration opened from Town, Board or another World view uses the
  active connection it names. Integrations and Connection settings no longer
  stay stuck waiting for Herdr when nothing is selected or the selection is
  on another host.
