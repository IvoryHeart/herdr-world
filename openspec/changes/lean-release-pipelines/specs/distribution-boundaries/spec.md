## MODIFIED Requirements

### Requirement: Reviewed release identity
Release preparation SHALL open or refresh one reviewed PR from green main. Main CI SHALL build and test the merged version commit's packages once and seal them. Publication SHALL require an owner-created version tag on that commit and green main CI, waiting while CI runs. The owner SHALL only merge the release PR, create its tag and merge the automatic Homebrew tap PR; no manual authorization, receipts or dispatch inputs intervene.

#### Scenario: Release preparation
- **WHEN** release PR automation is started with a version
- **THEN** it bumps the plugin version, assembles a short changelog section from change fragments, opens or refreshes one PR and dispatches its CI without pushing main or creating a tag
- **AND** that changelog section supplies the public release notes without a separate notes file

#### Scenario: Cross-platform release candidate
- **WHEN** an owner-created `vX.Y.Z-rc.N` tag selects the reviewed version commit
- **THEN** all six desktop archives and downstream packages use that exact version, GitHub marks it as a prerelease, npm uses `next` and a reviewed tap PR proposes the separate RC formula without changing stable Latest channels

#### Scenario: Early tag
- **WHEN** the tag arrives while the version commit's main CI is queued or running
- **THEN** publication waits for that CI to complete green and consumes its sealed bytes without rebuilding or retesting

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
A release SHALL publish only bytes that pass fresh installer starts on Linux/macOS x64/arm64, npm, Homebrew and native Windows archive starts; running-service upgrades from the previous published release through installer and Homebrew on Linux/macOS preserving data and service health; real Claude/Codex starts and World listings on TUI/core; and the shipped-dependency audit. The seal SHALL bind every publication file to the version and source commit.

#### Scenario: A channel or agent fails
- **WHEN** a Windows archive cannot launch, a running service upgrade loses health or data, an agent fails to start or list, or the shipped security audit fails
- **THEN** no verified seal is produced and no release channel is published

### Requirement: Recoverable release publication
Publication SHALL verify and keep identical existing GitHub assets, skip identical npm integrity and refresh one tap PR. A rerun SHALL finish remaining channels. Expired sealed artifacts SHALL trigger a complete rebuild and all release channel checks before publishing. Infrastructure failures SHALL retry once automatically. A failed release SHALL give one line identifying the failed stage and what a rerun does; Pages SHALL deploy independently of tap success.

#### Scenario: Publication is interrupted
- **WHEN** a run stops after GitHub publication
- **THEN** rerunning the same tag checks the sealed assets, retains the existing release and completes npm and the same tap PR without duplication

#### Scenario: Seal expired
- **WHEN** the exact commit's successful main run no longer retains its seal
- **THEN** the tag workflow rebuilds and verifies every channel contract before any publisher can proceed

### Requirement: Stable managed release service
A managed Homebrew World service SHALL execute through the selected formula's stable opt path, never a versioned Cellar path. A Homebrew upgrade SHALL refresh and restart a running generated service belonging to that formula, preserving its configuration and data, without taking over another installation's service.

#### Scenario: Running Homebrew upgrade
- **WHEN** Homebrew replaces and removes the previous keg while World is running as its managed service
- **THEN** World answers on the new version, its saved data remains intact and its service can restart after the old keg is gone
