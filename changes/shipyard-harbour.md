### Added

- Town's harbour shows each project's checks, waiting changes, releases and running Worlds in shipping lanes; open the same information from Work → Releases.

<!-- detail -->

- Town harbour at the town's right-most edge, on open sea, with one
  colour-coded shipping lane per project: main's checks in each lighthouse,
  merged changes waiting on the slipway, releases as ships and the Worlds
  running them, with links only. A phone's Town has the same harbour right of
  its buildings, and a Shipyard signpost on the town center flies there.
  Work → Releases shows the same per project;
  `?shipyardFixture` (and `=many` for more projects than lanes) shows
  synthetic states for testing.

### Changed

- Open pull requests moved from the post office to Town's new warehouse on the harbour's shore, as crates, on a phone too; Town's search finds them as the **Warehouse** ("warehouse" or "pull requests"); `?townPostFixture` is now `?townWarehouseFixture`.
