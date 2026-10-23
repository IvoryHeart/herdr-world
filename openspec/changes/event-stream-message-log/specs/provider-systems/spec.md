## Purpose

Integrate systems of record through provider contracts while preserving the
authority, provenance, capabilities and credential scope of each configured
source across World views and agent workflows.

## ADDED Requirements

### Requirement: Provider contracts by domain

World SHALL define one provider contract per domain: Code, Work, Runtime,
Observability, Docs, and Agents & skills. Each contract SHALL declare
capabilities, claims with provenance, verbs, auth/scopes and health, with
domain-specific facts and supported versions. One provider SHALL be able to
implement several domain contracts through configured provider instances.
Unsupported, unknown and unavailable capabilities SHALL remain distinguishable.

#### Scenario: One provider serves two domains
- **WHEN** a configured GitHub provider supports both Code and Work
- **THEN** World exposes its supported capabilities under both contracts without
  treating all code and issue facts as one undifferentiated authority

### Requirement: Scoped authority and provenance

A provider instance SHALL identify the account/site/host/repository scope and
datasets for which it reports facts. Capture SHALL preserve provider instance,
incarnation, source event identity or revision, author/channel, claim basis,
timestamps and evidence. Conflicting or inferred claims SHALL NOT silently
replace a system of record's facts. Adopting another system of record SHALL be
an explicit owner choice per domain/dataset scope and preserve prior provenance.

#### Scenario: Overlapping Work providers
- **WHEN** GitHub Issues and Jira both report work for the same repository scope
- **THEN** their claims retain distinct provenance and World does not silently
  choose authority by plugin order or merge their identities; an explicit owner
  decision can name the system of record for that scope without erasing provenance

### Requirement: Declared verbs and credential scopes

Each verb SHALL declare inputs/outcomes, conditions, risk, confirmation and
supported caller exposure. Invocations SHALL respect current provider scope
and applicable target/revision conditions. Existing browser-only restrictions
SHALL NOT be widened by installing a provider. World SHALL NOT include source
credentials in event payloads, browser responses, logs or plugin manifests.

#### Scenario: Provider cannot perform a declared operation now
- **WHEN** required scope or target conditions are absent
- **THEN** World reports the unmet condition and does not silently execute with
  broader credentials, another provider or a policy bypass

### Requirement: One connector lifecycle

Built-in and later installed providers SHALL share the install, configure,
enable and health contract. Users SHALL see Connector for a provider and
Connection for a configured instance. Built-ins SHALL be pre-installed
connectors, with configuration and enablement separate from installation and
health. Herdr connections SHALL preserve immutable connection IDs and runtime
generation qualification. Disablement SHALL stop new work, retain provenance
and mark stale observations without replaying uncertain side effects.

#### Scenario: Installed connector is not ready
- **WHEN** a connector is installed but its configured connection lacks a
  dependency or credential scope
- **THEN** World shows the unmet readiness condition and does not present
  installation or enablement as successful health

### Requirement: Connector eligibility preserves existing integrations

New connectors SHALL use a CLI or standard protocol rather than a bespoke API
connector. Existing Jira REST and OTel support SHALL remain unchanged and
first-class in Connections, without a legacy label or forced migration. This
phase SHALL prioritize existing Herdr, Claude/Codex and GitHub via `gh` coverage;
MCP and marketplace integration are later work outside this phase.

#### Scenario: Existing REST connection remains configured
- **WHEN** the provider lifecycle is introduced around an existing Jira connection
- **THEN** it retains its behavior and first-class status without a new CLI
  eligibility check or forced conversion

### Requirement: Profiles, seats and native skill bindings remain distinct

Runtime providers SHALL report native panes/terminals and occupants without
redefining World-owned seat identity. Persona/seat skill requirements SHALL be
harness-neutral. Each staffing SHALL explicitly bind those requirements to
harness, mode (native/plugin/injected), source-scoped artifact and effective
revision. Binding identity SHALL include harness and mode; source identity
SHALL include connection and repository/user/native-registry origin. Effective
digests SHALL cover skill content, referenced resources and binding recipe.
Equal names SHALL NOT imply equal artifacts or portable capabilities.

World SHALL use each harness's own registry/market where available and SHALL
NOT operate its own skill marketplace. World SHALL retain selections, bindings
and provenance separately from native installation and observed activation.
Discovery SHALL report version-qualified supported, unsupported, unavailable
and unknown capabilities, including supported binding modes. Installation
SHALL use the harness's declared operation with explicit owner confirmation;
it SHALL NOT silently grant permissions or attach skills. Desired changes
SHALL apply next start/shift, not hot-patch a running occupant.

#### Scenario: Same skill name on another harness
- **WHEN** a staffing changes harness and the new registry contains the same name
- **THEN** World requires an explicit compatible binding and does not infer
  equivalence, copy content or silently change binding mode

#### Scenario: Missing required binding
- **WHEN** a requested requirement lacks an unambiguous available binding for
  the selected staffing
- **THEN** readiness fails with that reason instead of silently omitting it

#### Scenario: Discovery cannot verify activation
- **WHEN** an adapter can enumerate artifacts but not prove runtime activation
- **THEN** desired selections and launch snapshot remain separate from an
  unknown activation observation

### Requirement: Eval evidence follows the effective binding

Critical-seat and shipped-default activation SHALL require matching evidence
for effective binding/skill and suite digests, harness/version, binding mode,
model, adapter/runner revisions and relevant tool/permission policy. Missing,
failed, interrupted or stale evidence SHALL NOT count as a pass. Other seats
SHALL display Experimental for unproven bindings; this SHALL NOT waive missing
bindings or the staffing's approved permission policy. Supported harness/mode
mappings SHALL require version-qualified evidence before agent-config UI work
proceeds under owner review.

#### Scenario: Binding mode changes after eval
- **WHEN** a skill passed with native loading but the selected binding uses injection
- **THEN** the old eval does not authorize critical-seat activation even when
  the source name or content digest is unchanged

#### Scenario: Runtime occupant changes
- **WHEN** a different harness session occupies the same configured World seat
- **THEN** Runtime claims describe the new occupant without replacing the seat
  or silently changing its profile or skill attachments
