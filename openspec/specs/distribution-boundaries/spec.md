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

#### Scenario: Plugin installation
- **WHEN** a user installs the `ivoryheart.herdr-world` Herdr plugin and invokes its start action
- **THEN** the plugin obtains and starts the matching Herdr World executable and exposes one World
  URL without installing or presenting Roamgate

#### Scenario: Existing browser state
- **WHEN** the Roamgate-derived World first runs on a browser that contains old World or Roamgate
  preference keys
- **THEN** it starts from validated World defaults and does not silently import old bridge URLs,
  credentials or presentation state
