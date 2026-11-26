## ADDED Requirements

### Requirement: OpenSpec capability discovery

The repository SHALL use native OpenSpec capability and active-change listing as
the single agent knowledge entry point. Agents SHALL read a capability's current
spec and adjacent notes, consult active deltas for work not yet archived, then
follow the notes' owning Code paths. There SHALL be no separate agent lookup
command or maintained discovery index.
Added or modified source files SHALL match at least one capability Code path;
the existing source tree SHALL have owners before enforcement. Feature PRs SHALL
update the capability notes' Code list in the same PR, including new storage and
rendering paths, even while their spec deltas remain active.
Usage prose SHALL live in capability notes or the tutorial; FEATURES.md SHALL be generated
at site build and SHALL NOT be committed or edited by feature PRs.

#### Scenario: Find quiet-agent storage and Town drawing before archival

- **WHEN** an agent follows AGENTS.md to find the quiet-agent setting and its Town drawing
- **THEN** native OpenSpec lists expose the Town capability and active quiet-agent change, and the Town notes name preference storage and rendering code without waiting for the archive bot

#### Scenario: A new source has no capability owner

- **WHEN** a PR changes a source file not covered by any notes Code path
- **THEN** the PR check fails and names that file, regardless of any former map-impact explanation

### Requirement: Reviewed post-merge contract synchronization

Feature PRs SHALL express contract changes only in their OpenSpec change folder, alongside
implementation and capability notes. A main push SHALL queue a single bot PR that applies
and archives completed merged changes in merge date order. Incomplete tasks SHALL remain
active. A conflict SHALL restore that change's partial writes and stop the batch, preserving
earlier successful archives for review. A stopped batch SHALL fail visibly even with no
archives; successful prefixes SHALL still be published. Bot branch repairs SHALL survive
subsequent main pushes. Automation SHALL never push to main or merge the PR.

#### Scenario: One feature changes

- **WHEN** a feature PR changes a contract
- **THEN** its contract edit is a change-folder delta rather than a direct current spec edit

#### Scenario: A later delta conflicts

- **WHEN** an earlier merged change archives successfully and a later change conflicts
- **THEN** the bot PR contains only the successful prefix, identifies the stopped change and leaves it and subsequent changes active


#### Scenario: Legacy synchronized changes precede this feature

- **WHEN** the feature-map migration encounters completed deltas already synchronized by the previous workflow
- **THEN** those deltas are archived once without rewriting current specs, and the next batch can reach unapplied deltas

#### Scenario: The first delta conflicts

- **WHEN** the oldest completed delta conflicts before any archive succeeds
- **THEN** the workflow fails and names that change in its log and summary rather than silently succeeding
