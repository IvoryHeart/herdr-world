## ADDED Requirements

### Requirement: Computed capability feature map

The repository SHALL compute feature discovery from OpenSpec capability names, Purpose,
requirement names and adjacent notes, including surfaces, code and pitfalls. Text and
JSON lookup SHALL expose matching spec paths, notes paths and owning Code paths without
a committed index. Changed source files SHALL match at least one capability Code path.
Usage prose SHALL live in capability notes or the tutorial; FEATURES.md SHALL be generated
at site build and SHALL NOT be committed or edited by feature PRs.

#### Scenario: Core desks cannot be dragged in Town

- **WHEN** an agent runs `bun run where "drag core desk"`
- **THEN** lookup includes the Town move requirement, Town drag code and herdr-core move path

#### Scenario: A new source has no capability owner

- **WHEN** a PR changes a source file not covered by any notes Code path
- **THEN** the PR check fails and names that file, regardless of any former map-impact explanation

### Requirement: Reviewed post-merge contract synchronization

Feature PRs SHALL express contract changes only in their OpenSpec change folder, alongside
implementation and capability notes. A main push SHALL queue a single bot PR that applies
and archives completed merged changes in merge date order. Incomplete tasks SHALL remain
active. A conflict SHALL restore that change's partial writes and stop the batch, preserving
earlier successful archives for review. Automation SHALL never push to main or merge the PR.

#### Scenario: One feature changes

- **WHEN** a feature PR changes a contract
- **THEN** its contract edit is a change-folder delta rather than a direct current spec edit

#### Scenario: A later delta conflicts

- **WHEN** an earlier merged change archives successfully and a later change conflicts
- **THEN** the bot PR contains only the successful prefix, identifies the stopped change and leaves it and subsequent changes active
