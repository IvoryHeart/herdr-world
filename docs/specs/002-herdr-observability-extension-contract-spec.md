# Herdr observability extension contract

- **Spec ID:** `002-herdr-observability-extension-contract`
- **Status:** Approved
- **Created:** 2026-08-05
- **Owner:** Herdr Office downstream project
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart (repository owner)
- **Approved at:** 2026-08-09

> This specification is approved and immutable. Implementation evidence belongs
> in the paired summary; later intended changes require a numbered extension.

## 1. Purpose

Herdr Office is expected to show optional observability information from AI
agents, including future OTEL-backed traces, logs, metrics, and activity
summaries. Herdr Server does not yet provide a stable extension surface for
this data, and Herdr Web currently has no generic extension contract.

This specification defines a small, upstreamable observability boundary that
can initially be implemented downstream in Herdr Web and later be provided by
an approved Herdr Server extension without requiring the Office UI to change.

The contract separates:

- the meaning and shape of observability data;
- the provider that obtains or derives that data;
- the Herdr Web transport that exposes it to browser clients; and
- the Office presentation that renders it.

## 2. Scope

This feature includes:

- a language-neutral, versioned observability contract package;
- generated or validated Rust and TypeScript representations for the current
  bridge and browser code;
- qualified Herdr target identity for correlating observability data with a
  host, workspace, tab, pane, terminal, or agent session;
- provider capability discovery and health state;
- a provider boundary that supports an initial downstream adapter and a later
  Herdr Server-native provider;
- an optional Herdr Web extension transport with snapshot and event semantics;
- explicit unavailable, degraded, incompatible, and unauthorized states;
- package ownership boundaries that keep generic contract work, OTEL-specific
  integration, Herdr Web transport, Office presentation, and distribution
  separately upstreamable; and
- contract fixtures and compatibility tests that can be used by providers and
  consumers independently.

The intended initial package roles are:

```text
observability-contract       shared schemas and generated types
otel-adapter                 OTLP/backend-specific provider implementation
herdr-web-extension          browser transport and capability registration
office-observability         Office boards and visual presentation
packaging                    complete downstream release assembly
```

The initial implementation MAY keep these packages in the current downstream
repository. Their source boundaries, tests, and public interfaces MUST remain
separable for later upstream contribution.

## 3. Non-goals

- No immediate modification to the official Herdr Server source or protocol.
- No assumption that Herdr Server already has an in-process plugin SDK.
- No requirement that OTEL ingestion run inside Herdr Server.
- No direct browser connection to an OTEL Collector, OTEL backend, database,
  or vendor API.
- No Office board, room layout, visual styling, or user interaction design in
  this contract specification.
- No multi-server gateway, SSH key management, or remote tunnel manager.
- No requirement to support every OTEL signal in the first provider.
- No persistence of raw logs, traces, metrics, credentials, or arbitrary
  provider payloads in Herdr Web.
- No public plugin marketplace or dynamic third-party JavaScript execution.

## 4. Context and constraints

### 4.1 Current runtime boundary

Herdr Server owns Herdr runtime state and currently exposes local API/socket
access. `herdr-web-bridge` is a host-local headless Herdr client and browser
HTTP/WebSocket adapter. It currently targets one Herdr runtime per process.

The first implementation SHALL therefore work without requiring a Herdr Server
change. A downstream provider MAY run beside the bridge and obtain OTEL data
from an operator-provided Collector or backend. A later Herdr Server extension
MAY provide the same contract through a server-owned API or event stream.

### 4.2 Provider independence

The Office UI SHALL depend on the observability contract and advertised
capabilities, not on OTLP wire details, a particular Collector, or a particular
backend vendor. A provider may be:

- a downstream Herdr Web adapter;
- an out-of-process OTEL adapter;
- a Herdr Server extension; or
- a test fixture provider.

Providers MUST NOT require consumers to know where the provider is deployed.

### 4.3 Herdr identity and correlation

Herdr-native identity is authoritative for Herdr entities. Observability data
MUST be correlated to qualified Herdr targets rather than to display labels,
hostnames alone, or mutable room positions.

The contract MUST support correlation fields for at least:

- bridge/host profile;
- Herdr workspace;
- Herdr tab;
- Herdr pane;
- Herdr terminal; and
- agent session where available.

Missing correlation MUST be represented as unknown or uncorrelated. The
provider MUST NOT infer a Herdr target from a display name when an exact target
is unavailable.

## 5. Requirements

### Requirement: Provide a versioned shared contract

The repository SHALL contain a language-neutral observability contract with a
stable contract identifier and explicit major/minor version.

#### Scenario: Rust bridge and TypeScript Office consume the contract

- **GIVEN** a provider emits an observability snapshot
- **WHEN** the bridge and Office validate the snapshot
- **THEN** both use the same language-neutral schema and contract version,
  rather than independently re-declaring the payload shape.

### Requirement: Keep the contract separate from provider implementation

The contract package MUST contain schemas, versioning, capability identifiers,
envelope types, validation rules, and fixtures. It MUST NOT contain OTEL client
credentials, Collector connections, backend queries, or Office rendering code.

#### Scenario: Provider implementation changes deployment location

- **GIVEN** an OTEL adapter initially runs beside Herdr Web
- **WHEN** an equivalent provider is later implemented inside or beside Herdr
  Server
- **THEN** the Office consumer can use the new provider without changing its
  data model or depending on the provider's deployment location.

### Requirement: Advertise provider capabilities

Each provider SHALL advertise its supported contract version, signal types,
target scopes, freshness characteristics, and health state before consumers
request provider data.

#### Scenario: Provider supports only traces

- **GIVEN** a provider supports traces but not logs or metrics
- **WHEN** the Office or bridge probes provider capabilities
- **THEN** traces are available and logs/metrics are explicitly unavailable;
  consumers do not infer support from a missing field.

### Requirement: Use qualified Herdr targets

Every target-scoped snapshot or event SHALL carry an exact qualified Herdr
target when correlation is available. The qualification SHALL include the
owning bridge/host profile and the Herdr entity kind and native identifier.

#### Scenario: Two hosts reuse a pane identifier

- **GIVEN** Host A and Host B both contain a pane with native ID `p1`
- **WHEN** observability data for both panes is admitted
- **THEN** the two records remain distinct and are never routed or displayed as
  the same target.

### Requirement: Support snapshots and live events

The contract SHALL support an initial bounded snapshot and an optional ordered
event stream. Events SHALL include provider sequence or replay information when
the provider can supply it, and consumers MUST be able to recover by requesting
another snapshot.

#### Scenario: Browser reconnects after an event gap

- **GIVEN** the Office loses the observability event stream
- **WHEN** it reconnects and detects a missing or unknown sequence
- **THEN** it requests a fresh snapshot and does not invent the missing events.

### Requirement: Expose extensions through an intentional web boundary

When a provider is exposed to the browser through Herdr Web, the bridge SHALL
mediate the access through an explicit extension capability and transport. The
browser MUST NOT connect directly to OTEL infrastructure.

#### Scenario: OTEL backend is reachable only by the host

- **GIVEN** the OTEL backend requires host-local credentials
- **WHEN** Office requests observability data
- **THEN** the bridge or provider performs the backend access and the browser
  receives only the admitted contract payload.

### Requirement: Preserve core Herdr operation without observability

Observability SHALL remain optional. A missing, disabled, offline,
incompatible, degraded, or unauthorized provider MUST NOT prevent normal
Herdr Web snapshot, terminal, Office, or Spaces functionality.

#### Scenario: No OTEL provider is configured

- **GIVEN** the user runs Herdr Web without an observability provider
- **WHEN** the Office loads
- **THEN** normal Herdr and Office functionality remains available and the
  observability capability is shown as unavailable rather than causing a
  page-level failure.

### Requirement: Keep provider data bounded

Providers SHALL return bounded snapshots and events appropriate for interactive
browser use. Raw unbounded logs, trace bodies, binary payloads, and arbitrary
backend responses MUST NOT be forwarded by default.

#### Scenario: Backend contains a large trace payload

- **GIVEN** a provider encounters a trace with large attributes or body data
- **WHEN** it creates an Office-facing payload
- **THEN** it applies the contract's size, field, and retention limits and
  reports truncation explicitly when applicable.

### Requirement: Preserve upstream seams

Generic contract and transport changes SHALL be implementable without copying
or permanently modifying the complete Herdr Server source tree. Herdr Server
integration code SHALL remain isolated from Office-specific visual code.

#### Scenario: Herdr declines the first server extension proposal

- **GIVEN** the downstream provider and contract are implemented in this
  repository
- **WHEN** Herdr does not accept the corresponding server change
- **THEN** the downstream provider remains usable through Herdr Web and the
  contract remains suitable for a later upstream proposal.

## 6. Data and interface contract

### 6.1 Extension descriptor

The initial descriptor SHALL contain, at minimum:

```text
extension_id       stable identifier, initially "observability"
contract_version   major/minor contract version
provider_id        provider implementation identifier
capabilities       supported signals and operations
target_scopes      supported Herdr target kinds
health             available/degraded/offline/incompatible/unauthorized
observed_at        provider observation time
```

### 6.2 Qualified target

The contract SHALL use a qualified target equivalent to:

```text
{
  "bridge_id": "...",
  "kind": "host | workspace | tab | pane | terminal | agent_session",
  "native_id": "..."
}
```

The exact wire encoding MAY follow the existing Herdr Web qualified-target
encoding, but the semantic qualification MUST remain explicit and stable.

### 6.3 Snapshot and event envelopes

Provider data SHALL be carried in an envelope containing:

```text
extension_id
contract_version
provider_id
target              optional qualified Herdr target
observed_at
status
payload
truncated           optional truncation metadata
```

The payload MAY evolve by capability and signal namespace. Consumers MUST use
advertised capabilities and MUST tolerate fields introduced by a compatible
minor version.

### 6.4 Compatibility

- A major contract mismatch SHALL mark the provider incompatible.
- A compatible minor version MAY add optional fields or capabilities.
- Required-field removal or semantic change requires a new major version.
- Provider-specific fields MUST be namespaced and MUST NOT silently redefine
  common contract fields.
- Malformed or unvalidated provider payloads MUST NOT enter the Office runtime
  cache as authoritative data.

### 6.5 Ownership

- Herdr Server remains authoritative for Herdr topology and terminal state.
- The provider remains authoritative for the observability signals it emits.
- Herdr Web owns transport, capability admission, caching, and browser routing.
- Office owns presentation and user navigation.
- The distribution layer owns version pinning and component assembly.

## 7. Privacy and security

- Browser code MUST NOT receive OTEL Collector credentials, backend tokens, SSH
  keys, or provider connection strings.
- Provider access MUST use operator-managed configuration and credentials outside
  the browser bundle.
- Extension access MUST follow the bridge's existing host/origin policy and
  terminal-equivalent trust model.
- Observability payloads MUST be treated as potentially sensitive because they
  may contain prompts, file paths, commands, logs, trace attributes, or user
  identifiers.
- The initial contract MUST define data minimisation, field allow-listing, size
  limits, and retention behaviour before raw logs or trace bodies are exposed.
- Extension capability checks are not authentication. Production remote access
  remains the responsibility of SSH, VPN, firewall, TLS, or an authenticated
  reverse proxy.

## 8. Acceptance evidence

Before implementation is considered complete, the project SHALL provide:

- schema validation tests for valid, malformed, incompatible, and truncated
  envelopes;
- generated Rust and TypeScript types or an equivalent drift check;
- provider fixture tests independent of a live OTEL backend;
- bridge tests for capability admission, snapshot transport, event recovery,
  target qualification, and provider failure isolation;
- Office tests proving that unavailable observability does not block normal
  Herdr interaction;
- a compatibility fixture showing the same provider payload can be consumed by
  the downstream Web implementation and a server-shaped provider;
- security tests proving provider credentials and connection details are not
  serialized into browser-facing payloads; and
- documentation describing the downstream implementation and the intended
  upstream contribution boundaries.

## 9. Deferred decisions

- Whether the first provider reads directly from an OTEL Collector, queries an
  OTEL backend, or consumes a project-specific intermediate store.
- Whether Herdr Server eventually hosts the provider in-process, beside the
  server as a managed extension, or through a public server API.
- The exact Herdr Server plugin/extension registration mechanism.
- The first set of OTEL signals and Office visualizations.
- Whether the generic extension transport becomes an official Herdr Web or
  Herdr Server protocol.
- Multi-server provider aggregation and cross-host trace correlation.
- User-configurable provider settings and packaging defaults.
- Long-term repository extraction from this downstream repository into one or
  more independently released packages.
