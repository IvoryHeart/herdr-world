### Changed

- Town shows one building per machine: this computer's Herdr TUI and
  herdr-core rooms stand in one building, each room tagged with its runtime
  and keeping all its own controls. Settings → Town & views → Town buildings →
  One per runtime keeps a building per runtime, as before.

### Fixed

- Two Herdr TUI connections to the same socket (the startup default and a
  saved profile) no longer show every room twice in Town.
- Focusing a far-off room from the keyboard no longer leaves Town blank: the
  view no longer scrolls the town out of sight.
