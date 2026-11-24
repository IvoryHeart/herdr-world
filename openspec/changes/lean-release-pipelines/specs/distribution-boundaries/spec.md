## MODIFIED Requirements

### Requirement: Reviewed release identity
Release-please SHALL keep one reviewed release PR current using the simple strategy in PR-only mode (`skip-github-release: true`). It SHALL update CHANGELOG from squash-merged fix/feat titles and the plugin version through its generic marker updater. Only the owner SHALL create a release tag on the merged version commit; no automation SHALL create tags. The owner SHALL only merge the release PR, create its tag and merge the automatic tap PR.

#### Scenario: Release preparation
- **WHEN** scheduled or dispatched release-please runs
- **THEN** it refreshes one release PR and automatically dispatches its checks without change fragments, a separate notes file or a manual run identifier
- **AND** the owner tags the merged release before the next release-please run

#### Scenario: Cross-platform release candidate
- **WHEN** an owner-created `vX.Y.Z-rc.N` tag selects the reviewed version commit on main
- **THEN** the tag workflow builds and tests all six native packages once with that exact version, marks GitHub as a prerelease, publishes npm under next and proposes the separate RC formula without changing stable Latest

#### Scenario: Main is still reporting evidence
- **WHEN** an owner tag arrives while main's metadata result is running
- **THEN** Release independently builds and tests the tagged bytes; main SHALL start no heavy checks and provide no release artifact

### Requirement: Reviewed post-merge contract synchronization
Feature PRs SHALL express contract changes in their OpenSpec change folder alongside implementation and capability notes. Completed merged changes SHALL synchronize through reviewed archive PRs in merge order; incomplete tasks SHALL stay active. The archive helper SHALL restore a conflicting change's partial writes and retain earlier successful archives. No Help or archive bot SHALL run on main pushes. Automation SHALL never push main or merge the PR.

#### Scenario: A completed change is archived
- **WHEN** the pinned archive helper prepares a synchronization PR
- **THEN** it applies completed merged changes in merge order and leaves incomplete changes active for later review

#### Scenario: A later delta conflicts
- **WHEN** an earlier change archives successfully and a later change conflicts
- **THEN** the helper retains only the successful prefix, names the conflicting change and leaves that change active

#### Scenario: One feature changes
- **WHEN** a feature PR changes a contract
- **THEN** its contract edit is a change-folder delta rather than a direct current spec edit

#### Scenario: Legacy synchronized changes precede this feature
- **WHEN** the archive helper encounters completed deltas already synchronized by the previous workflow
- **THEN** it archives them once without rewriting current specs and can reach later unapplied deltas

#### Scenario: The first delta conflicts
- **WHEN** the oldest completed delta conflicts before any archive succeeds
- **THEN** the archive helper fails and names the stopped change rather than silently succeeding

## ADDED Requirements

### Requirement: Tested release channels
A release SHALL publish only bytes that pass fresh installer starts on Linux/macOS x64/arm64, npm, Homebrew and native Windows archive starts; running-service upgrades from the previous published release through installer and Homebrew on Linux/macOS preserving data and service health; real Claude/Codex starts and World listings on TUI/core; and the shipped-dependency audit. Only the tag run and advisory nightly SHALL build native candidates. The standard immutable Actions artifact SHALL seal every tested publication file within that source run. Required PR checks SHALL run on Linux only and retry a failed test step once inside its job.

#### Scenario: A channel or agent fails
- **WHEN** a Windows archive cannot launch, a running service upgrade loses health or data, an agent fails to start or list, or the shipped security audit fails
- **THEN** no verified seal is produced and no release channel is published

### Requirement: Recoverable release publication
Publication SHALL use standard GitHub Release actions, npm publish with provenance and the Homebrew bump action with create-pullrequest and the tap token. Product-specific multi-platform Formula generation MAY complete the same PR through a standard PR action. Publication SHALL keep identical existing GitHub assets, skip matching npm integrity and reuse one tap PR. Infrastructure failures SHALL retry once automatically. Failed release summaries SHALL name the failed stage and rerun behavior; Pages SHALL deploy independently of tap success.

#### Scenario: Publication is interrupted
- **WHEN** a tag run stops after GitHub publication
- **THEN** rerunning failed jobs consumes its retained tested artifact, retains matching existing publications and completes npm and the same tap PR without duplication

#### Scenario: Seal expired
- **WHEN** a full rerun cannot retrieve its tested artifact
- **THEN** it rebuilds the tagged packages and verifies every channel contract before publication

### Requirement: Stable managed release service
A managed Homebrew World service SHALL execute through the selected formula's stable opt path, never a versioned Cellar path. A Homebrew upgrade SHALL refresh and restart a running generated service belonging to that formula, preserving its configuration and data, without taking over another installation's service.

#### Scenario: Running Homebrew upgrade
- **WHEN** Homebrew replaces and removes the previous keg while World is running as its managed service
- **THEN** World answers on the new version, its saved data remains intact and its service can restart after the old keg is gone
