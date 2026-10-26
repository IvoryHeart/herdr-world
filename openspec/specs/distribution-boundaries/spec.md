# Distribution boundaries

## Purpose

Preserve downstream source, runtime and release identities. [UPSTREAM](../../../UPSTREAM.md),
[packaging](../../../docs/packaging.md) and [release](../../../docs/release.md) own exact versions
and operational details.

## Requirements

### Requirement: Minimal compatibility source
The repository SHALL derive its application foundation from an exact Roamgate synchronization
point and SHALL retain only Herdr World source, required upstream-derived source and generated legal
notices. Herdr SHALL remain a separately installed external runtime: no World artifact bundles it.
World installers, the Homebrew Formula and World updates MAY install or upgrade it to the Herdr
release that World version verified, in Herdr's own default location.

#### Scenario: Desktop archive
- **WHEN** a release archive is built
- **THEN** it contains the Herdr World executable, embedded web assets, complete generated dependency
  inventory and licence/copyright texts, asset notices and documentation, without a bundled Herdr
  runtime, a second Roamgate executable or the retired Rust compatibility bridge

#### Scenario: Installation reuses existing Herdr
- **WHEN** the standalone World installer runs, or the Homebrew launcher starts
  the normal local World listener
- **THEN** an existing Herdr discovered through its explicit binary, PATH or default
  location retains its version and installation owner
- **AND** only a missing Herdr is installed from the release World verified, in
  Herdr's own default location, without starting a Herdr server
- **AND** a reachable Herdr server is reused without installing a second copy when
  its executable cannot be discovered
- **AND** an installed discovery result is admitted only after the selected entry
  is validated as a regular executable file; blocked entries are preserved and
  reported while World remains available
- **AND** a runtime appearing after lookup or during download is preserved;
  publication never replaces an existing filesystem entry
- **AND** Homebrew does not require a separate Herdr formula, bundle Herdr in its
  keg, or bootstrap for metadata/management commands or remote/custom endpoints
- **AND** failure of the optional runtime check or install warns with retry and
  opt-out guidance while World starts so remote profiles and in-app setup remain
  available

#### Scenario: Explicit update brings Herdr forward
- **WHEN** an explicit World update or Herdr upgrade runs with an older Herdr
- **THEN** World upgrades Herdr from the checksum-verified release and keeps a
  replaced binary for rollback
- **AND** it never downgrades a newer Herdr or Herdr server, replaces a package- or
  version-managed Herdr, or stops a running Herdr server; it hands a running server
  off live only when it can confirm that no service manager runs that server, and
  otherwise reports that a restart is needed

### Requirement: Reviewed release identity
Release preparation SHALL use a branch and reviewed PR. Final artifacts SHALL be built
from the final reviewed immutable release tag.

#### Scenario: Release preparation
- **WHEN** the release helper prepares a version
- **THEN** it produces a branch change without pushing main

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
