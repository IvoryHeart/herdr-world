## ADDED Requirements

### Requirement: Town and Board presentation

Town and Board SHALL present one Shipyard projection for a repository the user chooses on this browser, defaulting to the first suggestion. Board's Work lens SHALL have a Releases tab showing main's checks, waiting changes, shipped releases and running Worlds; Town SHALL show the same as a harbour beside its town center whose sign, crates and "All releases" open that tab, folding to one sign on narrow towns. Stale data, and data kept after the browser's own read of World fails, SHALL read as out of date with main's health unknown; a running World whose report is past its expiry or predates a failed read SHALL read as stopped reporting with no open link. Waiting changes SHALL name only pull requests the commit graph proves and SHALL NOT call other commits direct pushes; incomplete, diverged or unavailable waiting evidence SHALL NOT show a complete count. Presentation SHALL offer only navigation (release, pull request list, compare, workflow runs and fresh local World links opened in a new tab) and an explicit refresh request; it SHALL NOT create releases or tags, install, start previews or change deployments. A testing-only browser switch SHALL show synthetic populated, failing, stale, shortened, disabled, empty and World-unreachable states without contacting GitHub.

#### Scenario: A release is published while Town is open

- **WHEN** a later read lists a release the previous read did not
- **THEN** its ship sails into the newest berth and the change is announced, while the first read and a repository change animate nothing

#### Scenario: GitHub refresh fails

- **WHEN** the snapshot is stale
- **THEN** the harbour fades, its lamp is unknown, its sign and the Releases tab say out of date, and the last-read ships and waiting changes stay visible as old

#### Scenario: World stops answering after a good read

- **WHEN** a read succeeded and a later browser read of the Shipyard fails
- **THEN** Town and the Releases tab say out of date with main's health unknown, and every running World reads as stopped reporting without **Open**
