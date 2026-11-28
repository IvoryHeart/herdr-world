# World Shipyard

## Purpose

Provide bounded read-only release pipeline and local World deployment observations for shared CLI, Town and Board consumers, and present them as Town's harbour and the Work lens's Releases tab.

## Requirements

### Requirement: Read-only repository release pipeline

World SHALL provide a bounded shared Shipyard projection for an explicit github.com repository, using the existing GitHub source sign-in and enabled setting.

#### Scenario: Release evidence and pipeline health

- **WHEN** World reads a repository's release pipeline
- **THEN** It SHALL expose published releases with version, channel, publication time and safe links; tags; the observed main SHA and its workflow runs; and merged PRs whose merge commits are ahead of the release baseline on that main history. Drafts and bare tags SHALL NOT count as shipped releases. GitHub's designated latest published stable release SHALL define the baseline and SHALL be read independently of the display window, with prerelease fallback only when the complete window proves no stable release exists. Missing, diverged, truncated or unavailable evidence SHALL remain explicit and SHALL NOT imply zero waiting changes or healthy main. Health SHALL describe observed workflows, not release authorization.

#### Scenario: Every author's merged change is waiting

- **WHEN** a merged PR's merge commit is in the observed baseline-to-main difference
- **THEN** Shipyard includes it regardless of author, and excludes PRs merged into other branches or outside that difference

#### Scenario: Evidence is incomplete

- **WHEN** a comparison diverges, a required window is shortened or there is no published baseline
- **THEN** Shipyard explains the limit and cannot report a complete waiting list or infer one from dates

### Requirement: Bounded acquisition and failure provenance

World SHALL bound repository slots, refresh cadence, concurrent acquisition, requests, time, output and result windows. Failed refreshes SHALL retain last-success data only with stale provenance. Disabling GitHub SHALL hide its data and supersede older in-flight reads. Source failures SHALL use safe guidance rather than raw subprocess output. The HTTP API and CLI SHALL expose the same projection and enforce their existing browser or local-token admission boundaries.

#### Scenario: Refresh fails after a success

- **WHEN** GitHub fails after a successful pipeline read
- **THEN** last-success pipeline data remains visible as stale with its timestamp and no claim that it is current

#### Scenario: Source is disabled during a read

- **WHEN** GitHub is disabled while a refresh is running
- **THEN** that refresh cannot restore visible GitHub data

### Requirement: Local World instance observations

A listening World SHALL publish its version, actual bound port, generation and known source branch/repository in a private expiring local registry, and revoke its record on graceful shutdown.

#### Scenario: Instance registry privacy and freshness

- **WHEN** World publishes or reads local instance observations
- **THEN** Worlds running as the same user on the same machine SHALL share a registry by default, independently of their data folders; `HERDR_WORLD_INSTANCE_REGISTRY_DIR` MAY select a different private registry. Reads SHALL be bounded and SHALL NOT scan ports, contact advertised addresses, infer World deployments from agent runtimes or expose paths, PIDs or credentials. Expired observations SHALL be stale and SHALL have no open action. Only fresh loopback observations SHALL provide preview links; browser clients SHALL open links by ordinary navigation, preserving the one-origin application boundary.

#### Scenario: Preview is observed then expires

- **WHEN** an isolated preview reports into the shared registry and its report subsequently expires
- **THEN** its known version, port and branch can be displayed as stale, but its open URL is null

### Requirement: Navigation only in version one

Shipyard SHALL provide safe release, waiting-PR-list and fresh local-preview URLs. It SHALL NOT create releases or tags, install updates, start previews or mutate deployments. Unknown actions and malformed repository requests SHALL be refused before external reads. A testing-only synthetic CLI demonstration SHALL exercise unavailable, truncated and populated states without real hosts, credentials or source mutations.

#### Scenario: Release mutation is requested

- **WHEN** a client requests an unsupported release or deployment action
- **THEN** the request is refused and no external mutation is attempted

### Requirement: Town and Board presentation

Town and Board SHALL present one Shipyard projection for a repository the user chooses on this browser among the open projects' repositories, defaulting to the first; a repository the user types SHALL be one extra lane while it is chosen.

#### Scenario: Shipyard presentation and stale evidence

- **WHEN** Town or Board presents Shipyard
- **THEN** Board's Work lens SHALL have a Releases tab showing main's checks, waiting changes, shipped releases and running Worlds; Town SHALL show the same per project as a harbour at the town's right-most edge on open sea: one shipping lane per open project's repository, or typed repository, whose read lists at least one published release, each in its own colour, whose name board, next-release hull and ships' "All releases" open that project in that tab; projects beyond the lanes the sea holds SHALL be listed in one last lane. A project not read yet, with no published release, or whose read GitHub is off or signed out for SHALL have no lane and no pier; it stays in the Releases tab, and a harbour with no lane SHALL say why on its sign. Each lane's lighthouse SHALL stand on its pier's head past the last berth and be drawn above ships, so its lamp shows at every zoom and on a phone. The harbour's sign and its drawn lanes SHALL sit as one block vertically centred on the harbour's side of Town, not from its top. A narrow (phone or portrait) town SHALL show the same harbour, lanes and ships right of its stacked buildings, reachable by panning and zooming, with a signpost on the town center that moves the view to it. Open pull requests SHALL be Town's warehouse's, not the harbour's. Each lane SHALL appear as soon as its own read lands, without waiting for the others, and a lane whose own read fails SHALL keep its last answer as out of date without changing the others. Stale data, and data kept after the browser's own read of World fails, SHALL read as out of date with main's health unknown; a running World whose report is past its expiry or predates a failed read SHALL read as stopped reporting with no open link. Waiting changes SHALL name only pull requests the commit graph proves and SHALL NOT call other commits direct pushes; incomplete, diverged or unavailable waiting evidence SHALL NOT show a complete count. Presentation SHALL offer only navigation (release, pull request list, compare, workflow runs and fresh local World links opened in a new tab) and an explicit refresh request; it SHALL NOT create releases or tags, install, start previews or change deployments. A testing-only browser switch SHALL show synthetic populated, failing, stale, shortened, disabled, empty and World-unreachable states without contacting GitHub.

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

#### Scenario: A project with no release

- **WHEN** an open project's read lists no published release, has not answered yet, or finds GitHub off
- **THEN** the harbour shows no lane or pier for it while the Releases tab still lists it, and the project gains its lane once a read lists its first release

#### Scenario: Lighthouse always in view

- **WHEN** the harbour is seen at the widest, home or closest zoom on a phone or a desktop, including while a ship sails past the pier head
- **THEN** every lane's lamp is the topmost thing where it shines and stays a few screen pixels wide

### Requirement: Lanes from open projects

World SHALL derive Shipyard's projects from the rooms and spaces open in its runtimes (Herdr TUI and herdr-core), not from GitHub activity, running Worlds or earlier reads.

#### Scenario: Project discovery, bounds and refresh

- **WHEN** World derives Shipyard lanes from open projects
- **THEN** A project SHALL be a room or space on a current, non-stale connection with a folder (its checkout, else its own folder, else its first terminal's), on Unix and Windows runtimes alike, read with bounded, cached, read-only Git commands on that connection's host and qualified by connection ID and runtime generation; cached topology of a failed host SHALL contribute no project and grant no action. Its release source SHALL be the checkout's github.com remote, `origin` first; projects sharing a repository SHALL be one. A folder with no GitHub remote, because it is not a Git checkout, has none, or cannot be read, SHALL be listed as such, not dropped. The catalog SHALL list every open project; folders beyond its bound SHALL be counted and shown with a way to choose a repository, never dropped silently, and folders still being read SHALL be counted so clients ask again. GitHub reads SHALL run several at once within a fixed bound, keeping per-call deadlines and the cache; the cache SHALL hold a fixed number of repositories, and a repository asked for while every held one is reading SHALL wait its turn, not be added. The browser SHALL ask for the catalog often enough that a project that closes leaves Shipyard and one that opens joins it without a reload.

#### Scenario: One project open among many repositories

- **WHEN** the user can read hundreds of GitHub repositories but has one project open in World
- **THEN** Shipyard has that one project and no other lane

#### Scenario: An open project sorts late

- **WHEN** more than eight projects with releases are open, one whose repository sorts last
- **THEN** that project has its lane with its releases, and no open project is left out without saying so

#### Scenario: A project closes

- **WHEN** the room of an open project closes and no other room has that repository open
- **THEN** its lane leaves Shipyard on the next catalog read, without a page reload

#### Scenario: A folder without GitHub

- **WHEN** an open room's folder has no github.com remote, or is not a Git checkout yet
- **THEN** the Releases tab lists it as having no GitHub remote, and no GitHub read is made for it

#### Scenario: A project on a Windows runtime

- **WHEN** a room is open on a GitHub checkout in a Windows runtime
- **THEN** its project is read on that host and has its lane like any other

#### Scenario: More repositories asked than the cache holds

- **WHEN** a repository is asked for while every repository the cache holds is reading or waiting
- **THEN** it is not added and no read starts for it; it says it waits its turn and is asked again
