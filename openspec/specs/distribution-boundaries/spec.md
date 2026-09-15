# Distribution boundaries

## Purpose

Preserve downstream source, runtime and release identities. [UPSTREAM](../../../UPSTREAM.md),
[vendoring](../../../docs/vendoring.md) and [release](../../../docs/release.md) own exact versions
and operational details.

## Requirements

### Requirement: Minimal compatibility source
The repository SHALL retain only required Herdr compatibility source under vendor/herdr-compat.
The external Herdr runtime SHALL remain separately installed.

#### Scenario: Desktop archive
- **WHEN** a release tarball is built
- **THEN** it contains the World bridge, assets, launcher and notices, without a bundled Herdr
  runtime or full upstream source snapshot

### Requirement: Reviewed release identity
Release preparation SHALL use a branch and reviewed PR. Final artifacts SHALL be built
from the final reviewed immutable release tag.

#### Scenario: Release preparation
- **WHEN** the release helper prepares a version
- **THEN** it produces a branch change without pushing main

### Requirement: Downstream lineage
Each World release SHALL identify its exact Herdr Web synchronization point and distinguish
derived source from compatible external runtime requirements.

#### Scenario: Stale reference
- **WHEN** validation finds a missing or stale upstream correlation
- **THEN** it fails rather than relabeling an upstream release as a World release
