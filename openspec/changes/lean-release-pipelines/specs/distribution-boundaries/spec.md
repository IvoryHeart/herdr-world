## MODIFIED Requirements

### Requirement: Reviewed release identity
Release-please SHALL keep one reviewed release PR current using the simple strategy in PR-only mode (`release-pr`). It SHALL update CHANGELOG from squash-merged fix/feat titles and the plugin version through its generic marker updater. Only the owner SHALL create a release tag on the merged version commit; no automation SHALL create tags. The owner SHALL only merge the release PR, create its tag and merge the automatic tap PR.

#### Scenario: Release preparation
- **WHEN** scheduled or dispatched release-please runs
- **THEN** it refreshes one release PR and automatically dispatches its checks without change fragments, a separate notes file or a manual run identifier
- **AND** the owner tags the merged release before the next release-please run
- **AND** successful publication automatically replaces that exact merged release PR's pending label with the tagged label so the next release PR needs no manual bookkeeping

#### Scenario: Exact dispatched release version
- **WHEN** the owner dispatches Release PR with a valid `release_as` such as `0.3.8-rc.1`, `0.3.8-rc.2` or `0.3.8`
- **THEN** release-please opens or updates the release PR at exactly that version using its supported manifest override
- **AND** the override applies only to that run, without a direct main commit or another owner step
- **AND** an invalid version fails before release preparation

#### Scenario: Patch by default
- **WHEN** scheduled or dispatched release-please runs without `release_as` after `0.3.7`, including with merged `feat:` commits
- **THEN** it opens or updates the release PR at `0.3.8`
- **AND** minor and major bumps require an explicit `release_as`, such as `0.4.0`

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
A release SHALL publish only bytes that pass fresh installer starts on Linux/macOS x64/arm64, npm, Homebrew and native Windows archive starts; running-service upgrades from the previous published release through installer and Homebrew on Linux/macOS preserving data and service health; real Claude/Codex starts and World listings on TUI/core; and the shipped-dependency audit. Only the tag run and advisory nightly SHALL build native candidates. The standard immutable Actions artifact SHALL seal every tested publication file within that source run, and only after every contract job (packages, walks, fresh installs, npm and Homebrew checks, audit) succeeded; a cancelled or skipped contract job is not success. The seal SHALL record each contract job's result, and publication from retained bytes SHALL accept only a seal from the same run that records every contract job as succeeded. Required PR checks SHALL run on Linux only and retry a failed test step once inside its job.

#### Scenario: A channel or agent fails
- **WHEN** a Windows archive cannot launch, a running service upgrade loses health or data, an agent fails to start or list, or the shipped security audit fails
- **THEN** no verified seal is produced and no release channel is published

#### Scenario: A contract job is cancelled
- **WHEN** a contract job is cancelled or never gets a runner while the others succeed
- **THEN** no verified seal is produced
- **AND** a rerun that finds retained bytes without a record of every contract job succeeding builds and tests the tagged bytes again before publication

### Requirement: Recoverable release publication
Publication SHALL use standard GitHub Release actions, npm publish with provenance and the Homebrew bump action with create-pullrequest and the tap token. Product-specific multi-platform Formula generation MAY complete the same PR through a standard PR action. Publication SHALL keep identical existing GitHub assets, skip matching npm integrity and reuse one tap PR. Infrastructure failures SHALL retry once automatically. Failed release summaries SHALL name the failed stage and rerun behavior; Pages SHALL deploy independently of tap success.

#### Scenario: Publication is interrupted
- **WHEN** a tag run stops after GitHub publication
- **THEN** rerunning failed jobs or all jobs consumes its retained tested artifact, retains matching existing publications and completes npm, the same tap PR and the exact merged release PR's tagged label without duplication
- **AND** skipping a publisher or label completion is reported as incomplete rather than successful

#### Scenario: Tap credentials are scoped to release tags
- **WHEN** an owner-created release tag reaches Homebrew publication
- **THEN** only the Homebrew PR job uses the tag-only `release` environment to access its tap token
- **AND** npm retains OIDC trusted publishing without that environment

#### Scenario: Seal expired
- **WHEN** a full rerun cannot retrieve its tested artifact
- **THEN** it rebuilds the tagged packages and verifies every channel contract before publication

### Requirement: Stable managed release service
A managed Homebrew World service SHALL execute through the selected formula's stable opt path, never a versioned Cellar path. A Homebrew upgrade SHALL refresh and restart a running generated service belonging to that formula automatically, preserving its configuration and data, without taking over another installation's service. Homebrew's post-install sandbox cannot read the home folder, so the post-install step SHALL find the service manager's main process started from that formula's kegs (on macOS, the process launchd started for World's job label, never a terminal World launchd adopted), point older keg executables at opt, signal that process and wait until the service runs from opt. A supervised World started from a keg whose generated definition still names a versioned keg SHALL move that definition to opt before it listens.

#### Scenario: Running Homebrew upgrade
- **WHEN** Homebrew replaces and removes the previous keg while World is running as its managed service
- **THEN** World answers on the new version, its saved data remains intact and its service can restart after the old keg is gone

#### Scenario: Upgrade from a release whose service names its keg
- **WHEN** the running service's definition names the previous release's versioned keg and Homebrew upgrades the formula
- **THEN** the service restarts on the new version without a manual step and its definition names opt before Homebrew removes the old keg
- **AND** a World started from that formula in a terminal, and another formula's service, are left running
