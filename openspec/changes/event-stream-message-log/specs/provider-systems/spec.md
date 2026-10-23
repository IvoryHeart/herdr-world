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
explicit and preserve prior provenance.

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

### Requirement: Profiles, seats and skill distribution remain distinct

Runtime providers SHALL report native panes/terminals and occupants without
redefining World-owned seat identity. Agents & skills providers SHALL preserve
profile/staffing definitions and source/version provenance. Marketplace
discovery or installation SHALL NOT automatically activate a plugin, attach a
skill or grant runtime permissions. Critical-seat skill activation SHALL require
matching eval evidence for the skill/suite digests, harness/version, model,
runner revision and relevant configuration/permission policy.

#### Scenario: Marketplace skill lacks current eval evidence
- **WHEN** an installed skill's digest or required eval tuple does not match
- **THEN** installation alone does not make it eligible for a critical seat

#### Scenario: Runtime occupant changes
- **WHEN** a different harness session occupies the same configured World seat
- **THEN** Runtime claims describe the new occupant without replacing the seat
  or silently changing its profile or skill attachments
