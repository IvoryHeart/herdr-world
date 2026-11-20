## ADDED Requirements

### Requirement: Town and Board presentation

Town and Board SHALL present one Shipyard projection for a repository the user chooses on this browser, defaulting to the first suggestion. Board's Work lens SHALL have a Releases tab showing main's checks, waiting changes, shipped releases and running Worlds; Town SHALL show the same per project as a harbour at the town's right-most edge on open sea: one shipping lane per suggested repository and the chosen one, each in its own colour, whose name board, next-release hull and ships' "All releases" open that project in that tab; projects beyond the lanes the sea holds SHALL be listed in one last lane. A narrow (phone or portrait) town SHALL show the same harbour, lanes and ships right of its stacked buildings, reachable by panning and zooming, with a signpost on the town center that moves the view to it. Open pull requests SHALL be Town's warehouse's, not the harbour's. A lane whose own read fails SHALL keep its last answer as out of date without changing the others. Stale data, and data kept after the browser's own read of World fails, SHALL read as out of date with main's health unknown; a running World whose report is past its expiry or predates a failed read SHALL read as stopped reporting with no open link. Waiting changes SHALL name only pull requests the commit graph proves and SHALL NOT call other commits direct pushes; incomplete, diverged or unavailable waiting evidence SHALL NOT show a complete count. Presentation SHALL offer only navigation (release, pull request list, compare, workflow runs and fresh local World links opened in a new tab) and an explicit refresh request; it SHALL NOT create releases or tags, install, start previews or change deployments. A testing-only browser switch SHALL show synthetic populated, failing, stale, shortened, disabled, empty and World-unreachable states without contacting GitHub.

#### Scenario: A release is published while Town is open

- **WHEN** a later read lists a release the previous read did not
- **THEN** its ship sails into the newest berth of that project's lane only and the change is announced, while the first read and a repository change animate nothing

#### Scenario: GitHub refresh fails

- **WHEN** the snapshot is stale
- **THEN** that project's lane fades, its lamp is unknown, its board, the harbour's sign and the Releases tab say out of date, and the last-read ships and waiting changes stay visible as old

#### Scenario: World stops answering after a good read

- **WHEN** a read succeeded and a later browser read of the Shipyard fails
- **THEN** Town and the Releases tab say out of date with main's health unknown, and every running World reads as stopped reporting without **Open**

#### Scenario: Town on a phone

- **WHEN** Town is laid out narrow and the user pans right, or taps the Shipyard signpost on the town center
- **THEN** the harbour's sea, its project lanes and their ships come into view as on a wide town, the signpost framing the promenade and a whole pier across the screen

#### Scenario: More projects than lanes

- **WHEN** the harbour has more projects than its sea holds lanes
- **THEN** every lane but the last shows one project, and the last lists the rest by name and state, each opening its Releases tab
