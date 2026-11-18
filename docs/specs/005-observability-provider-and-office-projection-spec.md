# Observability provider and Office projection

- **Spec ID:** `005-observability-provider-and-office-projection`
- **Status:** Approved
- **Created:** 2026-08-10
- **Owner:** Herdr Office downstream project
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart
- **Approved at:** 2026-08-10

> The initial provider slice is approved: read the existing local Prometheus
> sink for cost, usage, and model metrics. Office presentation and exact
> Herdr-agent correlation remain subsequent implementation slices.

## 1. Purpose

Spec 002 established the contract and bridge seam for optional observability
data but deliberately did not connect an OTEL provider or render telemetry in
Office. This feature will add a downstream provider adapter and the first
Office-facing presentation while keeping both replaceable by a later
Herdr-native provider or another World projection.

The provider boundary will support two source modes behind the same Spec 002
contract:

1. an existing-sink adapter, which reads from an operator-configured,
   queryable telemetry backend, materialized store, or collector extension; and
2. an optional direct-source adapter for harness data that is not present in a
   sink or for installations without a usable sink.

The first implementation SHOULD prefer the existing-sink mode. Direct-source
support is an additional adapter, not a requirement for every harness and not
a second browser-facing protocol.

## 2. Scope

This feature is expected to include:

- one provider adapter that obtains a bounded, operator-configured subset of
  observability data;
- explicit provider capability and health reporting through the Spec 002
  contract;
- correlation to qualified Herdr host/workspace/tab/pane/terminal/agent
  targets where the source supports it;
- provider-side minimisation, redaction, retention, and truncation before data
  crosses the bridge; and
- an Office projection that presents useful observability information without
  making the Office renderer aware of OTLP, Collector, or backend details.

The initial user value is cost, token usage, and model visibility. Activity
summaries are optional bells and whistles and are deferred until the primary
metrics path is useful.

## 3. Non-goals

- No direct browser connection to an OTEL Collector, backend, database, or
  vendor API.
- No assumption that an OTLP export endpoint is queryable. OTLP is the
  transport used to deliver telemetry between sources, collectors, and
  backends; reading existing data requires a backend query API, a materialized
  store, or a collector extension.
- No provider credentials, SSH keys, backend tokens, or arbitrary raw logs in
  the Office UI.
- No requirement to support every OTEL signal initially.
- No Herdr Server modification in the first downstream implementation.
- No multi-server aggregation, durable telemetry store, or public plugin
  marketplace.
- No per-agent or room cost attribution claims until a reviewed correlation,
  attribution model, and unit policy exist.

## 4. Context and constraints

The provider must fit the merged Spec 002 contract and remain optional. Herdr
Web and Office must continue operating when the provider is absent, degraded,
unauthorized, or incompatible. Herdr-native identity is authoritative; display
labels, room positions, git authors, and hostnames alone are insufficient for
correlation.

The provider may eventually be moved into or beside Herdr Server, so the
Office projection MUST depend only on the contract and not on provider
deployment details.

## 5. Requirements

### Requirement: Isolate provider access

The provider SHALL own its OTEL/backend client, configuration, credentials,
source-specific queries, and provider tests. No provider-specific dependency
or credential SHALL be required by the core bridge when the provider is not
enabled.

#### Scenario: Provider is not configured

- **GIVEN** a normal World installation has no provider configuration
- **WHEN** Herdr Web and Office start
- **THEN** core operation remains available and the observability descriptor
  reports the explicit unavailable state.

### Requirement: Support existing sinks without forcing a new collection path

The provider layer SHALL allow an operator to point `herdr-world` at an
existing queryable telemetry sink or materialized view. It MUST NOT require
agents to export a second copy of telemetry solely for the Office projection.

#### Scenario: The user already has an OTEL deployment

- **GIVEN** agents export through the user's existing Collector and backend
- **WHEN** `herdr-world` is configured for observability
- **THEN** it uses a read adapter for that existing deployment, preserves the
  user's retention/redaction policy, and does not introduce a parallel
  collection pipeline by default.

#### Scenario: The local Prometheus sink is available

- **GIVEN** the bridge is configured with `HERDR_WORLD_OTEL_PROMETHEUS_URL`
- **WHEN** the provider polls the Prometheus HTTP API
- **THEN** it reads bounded model, usage, and cost queries from the existing
  sink and emits them through the Spec 002 snapshot contract.

#### Scenario: The provider has no exact Herdr correlation key

- **GIVEN** the source exposes model and harness labels but no stable Herdr
  pane/session identity
- **WHEN** the provider builds a snapshot
- **THEN** it aggregates by provider and model without inventing an agent,
  pane, workspace, or room attribution.

### Requirement: Keep direct-source support additive

Direct harness/source adapters MAY be added when a sink does not expose the
required data, but they SHALL emit the same contract and SHALL remain
replaceable by an existing-sink or Herdr Server provider.

#### Scenario: No queryable sink exists

- **GIVEN** a harness exposes useful activity data but the installation has no
  queryable telemetry backend
- **WHEN** a reviewed direct-source adapter is enabled
- **THEN** it supplies only the bounded fields it owns, reports its health and
  source identity, and leaves the Office projection unchanged.

### Requirement: Correlate without guessing

The provider SHALL emit qualified Herdr targets only when exact correlation is
available. Unknown or ambiguous correlation SHALL remain unknown rather than
being inferred from labels, git authors, hostnames, or room positions.

#### Scenario: Two hosts expose the same native pane ID

- **GIVEN** two hosts each report a pane with native ID `p1`
- **WHEN** provider data is admitted
- **THEN** the records remain distinct by bridge/host qualification.

### Requirement: Minimise before transport

The provider SHALL apply allowlisting, redaction, size bounds, retention
limits, and explicit truncation metadata before emitting a contract envelope.
Raw logs, trace bodies, binary attributes, and backend responses MUST NOT be
forwarded by default.

#### Scenario: A trace contains a large sensitive attribute

- **GIVEN** the source contains a large attribute with credential-like data
- **WHEN** the provider creates an Office-facing envelope
- **THEN** the sensitive value is rejected or redacted and the bounded result
  reports truncation where applicable.

### Requirement: Keep Office provider-neutral

The Office projection SHALL consume only the validated observability contract,
qualified targets, capabilities, health, and freshness metadata. It MUST NOT
import OTLP types, backend SDKs, provider credentials, or source-specific
queries.

#### Scenario: Provider deployment changes

- **GIVEN** a downstream adapter is replaced by a Herdr Server provider
- **WHEN** Office receives the equivalent contract data
- **THEN** the Office projection continues to operate without a provider code
  change.

### Requirement: Make user value legible and optional

The first Office surface SHALL display only approved, bounded information with
clear unavailable/degraded states and SHALL not obscure core agent, desk,
terminal, or room interactions.

#### Scenario: Observability is degraded

- **GIVEN** the provider reports degraded health
- **WHEN** the user opens Office
- **THEN** core interaction remains usable and the observability surface shows
  a concise degraded state instead of stale or invented totals.

## 6. Data and interface contract

The provider SHALL use the versioned Spec 002 descriptor, snapshot, envelope,
and event transport. Provider-specific fields SHALL remain namespaced within
the bounded payload. The projection SHALL consume capability, health,
freshness, target, sequence, and truncation metadata.

The first provider uses one bounded `herdr-world.otel.metrics` envelope. Its
data contains the configured window, source/aggregation mode, and model rows
with provider, model, usage categories, and optional `cost_usd`. A row may also
identify whether its cost is `reported`, `estimated`, `estimated_fallback`, or
`estimated_partial`. Claude cost and usage counters and Codex usage metrics are
queried with a bounded Prometheus `increase()` window. Provider-specific labels
are allowlisted into the model rows; raw labels are not forwarded.

The first implementation is configured with:

```text
HERDR_WORLD_OTEL_PROMETHEUS_URL
HERDR_WORLD_OTEL_PROMETHEUS_WINDOW_SECONDS=86400
HERDR_WORLD_OTEL_PROMETHEUS_REFRESH_SECONDS=30
HERDR_WORLD_OTEL_PROMETHEUS_MAX_MODELS=128
HERDR_WORLD_OTEL_OPENAI_PRICING_JSON=<optional JSON rate-card override>
```

When OpenAI cost is absent from the source metrics, the provider calculates a
standard API-equivalent estimate from the model-aware rate card. Cached input
is treated as a subset of input, cache writes are charged separately when a
rate is available, and reasoning output is not charged twice when it is an
output breakdown. Unknown models use the disclosed fallback rate-card row.
Built-in rates are versioned and can be replaced per deployment with the JSON
override; these values are estimates, not invoices or subscription debits.

The provider is `degraded` with an empty snapshot when a refresh fails. The
bridge remains fully usable without this environment variable or without a
running Prometheus endpoint.

The approved first slice defines:

- the initial provider source and deployment model;
- the first supported signals and operations;
- correlation fields and fallback behaviour;
- refresh/freshness expectations; and
- the first Office surface as two compact CEO-office boards: the live admitted
  state board and a separate `LAST 24H` board with model, tokens, and either
  source-reported or visibly estimated cost columns; detailed Office
  interaction rules remain implementation follow-up.

## 7. Privacy and security

- Credentials and backend connection details remain host/provider-local.
- The browser receives only validated, bounded, minimised payloads.
- Provider configuration MUST support redaction and deny-by-default fields.
- Raw prompts, secrets, full trace bodies, and arbitrary logs are excluded
  unless a later reviewed extension explicitly defines a safe representation.
- The first board may show source-reported aggregate cost or a visibly marked
  API-equivalent estimate with its configured time window; per-agent and
  per-room cost attribution remains excluded until its source, currency/unit,
  and uncertainty policy are approved.

## 8. Acceptance evidence

Acceptance SHALL include:

- provider contract and fixture tests using the merged Spec 002 schema;
- unavailable, degraded, incompatible, and redaction/security tests;
- qualified-target collision tests across multiple hosts;
- bounded snapshot/event and resync tests;
- Office projection tests with no provider configured;
- browser and visual evidence for the approved first surface; and
- documentation of provider configuration, credentials, retention, and
  operational failure behaviour.

## 9. Deferred decisions

- OTEL Collector versus backend versus an intermediate local store.
- Which existing sink query APIs to support first and how they authenticate.
- Whether a direct harness adapter is needed for the first release.
- Initial signal set: activity, traces, logs, metrics, or a reviewed subset.
- Harness summary availability and attribution policy.
- Per-agent and per-room cost attribution and display.
- Exact Office boards, room markers, bar/reception callouts, and settings.
- Herdr Server-native provider integration.
- Multi-server aggregation and remote provider authentication.
