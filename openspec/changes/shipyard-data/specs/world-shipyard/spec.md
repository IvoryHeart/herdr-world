## Purpose

Provide bounded read-only release pipeline and local World deployment observations for shared CLI, Town and Board consumers. Visual presentation is delivered separately.

## ADDED Requirements

### Requirement: Read-only repository release pipeline

World SHALL provide a bounded shared Shipyard projection for an explicit github.com repository, using the existing GitHub source sign-in and enabled setting. It SHALL expose published releases with version, channel, publication time and safe links; tags; the observed main SHA and its workflow runs; and merged PRs whose merge commits are ahead of the release baseline on that main history. Drafts and bare tags SHALL NOT count as shipped releases. GitHub's designated latest published stable release SHALL define the baseline and SHALL be read independently of the display window, with prerelease fallback only when the complete window proves no stable release exists. Missing, diverged, truncated or unavailable evidence SHALL remain explicit and SHALL NOT imply zero waiting changes or healthy main. Health SHALL describe observed workflows, not release authorization.

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

A listening World SHALL publish its version, actual bound port, generation and known source branch/repository in a private expiring local registry, and revoke its record on graceful shutdown. Isolated previews MAY explicitly share a registry. Reads SHALL be bounded and SHALL NOT scan ports, contact advertised addresses, infer World deployments from agent runtimes or expose paths, PIDs or credentials. Expired observations SHALL be stale and SHALL have no open action. Only fresh loopback observations SHALL provide preview links; browser clients SHALL open links by ordinary navigation, preserving the one-origin application boundary.

#### Scenario: Preview is observed then expires

- **WHEN** an isolated preview reports into the shared registry and its report subsequently expires
- **THEN** its known version, port and branch can be displayed as stale, but its open URL is null

### Requirement: Navigation only in version one

Shipyard SHALL provide safe release, waiting-PR-list and fresh local-preview URLs. It SHALL NOT create releases or tags, install updates, start previews or mutate deployments. Unknown actions and malformed repository requests SHALL be refused before external reads. A testing-only synthetic CLI demonstration SHALL exercise unavailable, truncated and populated states without real hosts, credentials or source mutations.

#### Scenario: Release mutation is requested

- **WHEN** a client requests an unsupported release or deployment action
- **THEN** the request is refused and no external mutation is attempted
