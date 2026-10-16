# Distribution boundaries

## Purpose

Preserve downstream source, runtime and release identities. [UPSTREAM](../../../UPSTREAM.md),
[packaging](../../../docs/packaging.md) and [release](../../../docs/release.md) own exact versions
and operational details.

## Requirements

### Requirement: Minimal compatibility source
The repository SHALL derive its application foundation from an exact Roamgate synchronization
point and SHALL retain only Herdr World source, required upstream-derived source and generated legal
notices. Herdr SHALL remain a separately installed external runtime.

#### Scenario: Desktop archive
- **WHEN** a release archive is built
- **THEN** it contains the Herdr World executable, embedded web assets, complete generated dependency
  inventory and licence/copyright texts, asset notices and documentation, without a bundled Herdr
  runtime, a second Roamgate executable or the retired Rust compatibility bridge

### Requirement: Reviewed release identity
Release preparation SHALL use a branch and reviewed PR. Final artifacts SHALL be built
from the final reviewed immutable release tag.

#### Scenario: Release preparation
- **WHEN** the release helper prepares a version
- **THEN** it produces a branch change without pushing main

#### Scenario: Daily patch preparation
- **WHEN** the daily check finds actual Unreleased changes, a completely published stable
  baseline and no existing release PR
- **THEN** it proposes only the next patch version through a normal release PR with generated
  lineage, upgrade guidance and standing known issues
- **AND** independent human review and required checks remain necessary; minor, major and
  release candidates remain manual

#### Scenario: Daily patch publication
- **WHEN** a bot-prepared patch PR is reviewed and merged with required checks passing
- **THEN** automation tags its exact version-changing merge commit with an authorized identity,
  even if main has advanced, and starts the existing release validation and publication workflow
- **AND** an existing tag cannot move; pending publication blocks another preparation,
  failed publication retries the same immutable revision, and canceled or indeterminate
  publication requires operator attention

#### Scenario: Cross-platform release candidate
- **WHEN** a reviewed `vX.Y.Z-rc.N` tag is published
- **THEN** all six desktop archives and downstream packages use that exact version,
  GitHub marks it as a prerelease, npm publishes it under `next`, a reviewed
  Homebrew PR proposes the separate RC Formula, and the stable Latest channels
  remain unchanged

### Requirement: Downstream lineage
Each World release SHALL identify its exact Roamgate synchronization point and distinguish derived
application source from compatibility with the external Herdr runtime.

#### Scenario: Stale reference
- **WHEN** validation finds a missing or stale Roamgate correlation
- **THEN** it fails rather than presenting an unrecorded upstream revision as World source

### Requirement: Single World product identity
All user-facing executables, archives, update metadata, services, configuration directories,
browser storage and Herdr plugin entries SHALL use Herdr World identities. Required licence and
copyright attribution SHALL name upstream projects without requiring them as separately installed
products. The embedded frontend and compiled service SHALL expose the same reviewed release version.

#### Scenario: Tagged application version
- **WHEN** a tagged release builds the embedded frontend and compiled service
- **THEN** both display or report that tagged version rather than a private development-manifest value

#### Scenario: Source development version
- **WHEN** World is built from a Git checkout without a reviewed release version injection
- **THEN** the frontend and service identify the reachable tag and source revision rather than
  displaying the private `0.0.0` manifest placeholder as the product version

#### Scenario: Plugin installation
- **WHEN** a user installs the `ivoryheart.herdr-world` Herdr plugin and invokes its start action
- **THEN** the plugin obtains and starts the matching Herdr World executable and exposes one World
  URL without installing or presenting Roamgate

#### Scenario: Released plugin without Bun
- **WHEN** a Unix or Windows user installs a published World plugin without Bun
- **THEN** its system installer verifies the matching World release checksum, metadata,
  executable version and native plugin support before replacing the installation
- **AND** cached `server/herdr-world-plugin.exe <verb>` actions remain usable,
  service operations retain the canonical World executable and update owner,
  and the external Herdr runtime is never stopped
- **AND** unreleased source builds and local linking explicitly continue to require Bun

#### Scenario: Existing browser state
- **WHEN** the Roamgate-derived World first runs on a browser that contains old World or Roamgate
  preference keys
- **THEN** it starts from validated World defaults and does not silently import old bridge URLs,
  credentials or presentation state
