# Office observability settings

- **Spec ID:** `006-office-observability-settings`
- **Status:** Implemented
- **Created:** 2026-08-10
- **Owner:** Herdr Web / Office
- **Reviewers:** —
- **Approved by:** Requester
- **Approved at:** 2026-08-11

> This records the downstream implementation boundary. It is not an upstream
> API commitment; the live bridge configuration seam still requires review
> before it is proposed outside this repository.

## 1. Purpose

The Office currently receives optional Prometheus-backed observability data
only when the host-local bridge is started with
`HERDR_WORLD_OTEL_PROMETHEUS_URL`. That is easy to omit and is not discoverable
from the application. Users need a clear Settings surface for configuring the
Prometheus source used by the Office metrics board, with visible connection
state and safe failure behaviour.

## 2. Scope

This feature is expected to include:

- an Office/observability section in the existing Settings panel;
- configuration of an optional Prometheus HTTP API URL;
- validation, save, clear, and persistence behaviour for that setting;
- an explicit health/status result when the provider is unavailable,
  degraded, or working; and
- bridge/provider wiring so the configured value can affect the host-local
  Office observability provider.

The setting should fit the existing Herdr Web and Office settings ownership
model rather than becoming a general Herdr runtime configuration editor.

## 3. Non-goals

- No direct browser connection to Prometheus, OTEL Collector, Loki, Grafana,
  or another telemetry backend.
- No credentials, bearer tokens, passwords, or arbitrary Prometheus query
  editing in the initial setting.
- No removal of the existing environment-variable startup path. The current
  downstream precedence is: no saved Office value leaves the environment
  configuration effective; a saved or explicitly cleared per-bridge Office
  value overrides it for that browser.
- No change to Herdr session, terminal, workspace, or Office roster
  authority.
- No requirement to configure remote bridges through a local browser unless a
  later federation design explicitly defines that scope.

## 4. Context and constraints

The approved observability provider spec defines the bridge as the owner of
provider access and keeps the browser provider-neutral. The current provider
is configured at bridge startup with:

```text
HERDR_WORLD_OTEL_PROMETHEUS_URL
```

The browser must not bypass the bridge to query Prometheus. A Settings control
therefore needs a reviewed bridge configuration seam, a persisted local
operator setting consumed by the bridge, or another explicitly authorised
mechanism. Sending an arbitrary URL from the browser to an already-running
bridge must not silently create an SSRF or cross-origin access path.

The setting must remain optional. Herdr sessions, live Office state, and core
terminal operation must work when no URL is configured or when Prometheus is
unreachable.

## 5. Requirements

### Requirement: Make the provider setting discoverable

The Settings panel SHALL expose an Office/Observability area that explains
that the Prometheus URL is optional and only supplies aggregate Office metrics.

#### Scenario: User opens Settings

- **GIVEN** Herdr Web is connected to a compatible bridge
- **WHEN** the user opens Settings
- **THEN** the user can find the optional Office observability configuration
  without navigating to developer documentation.

### Requirement: Validate and persist the URL

The setting SHALL accept a valid HTTP or HTTPS Prometheus base URL, reject
malformed values with an actionable error, support clearing the value, and
persist the accepted value according to the approved settings scope.

#### Scenario: User saves a valid local Prometheus URL

- **GIVEN** the user enters `http://127.0.0.1:9101`
- **WHEN** the user saves the setting
- **THEN** the value is accepted, persisted, and displayed as the active
  provider configuration.

#### Scenario: User enters an invalid URL

- **GIVEN** the user enters a malformed, unsupported, or credential-bearing
  value
- **WHEN** the user attempts to save it
- **THEN** the value is rejected locally with a clear validation message and
  the last valid configuration remains unchanged.

### Requirement: Apply configuration through the bridge boundary

The system SHALL route provider configuration through an explicitly authorised
host-local bridge mechanism. The browser MUST NOT query Prometheus directly or
send unrestricted backend URLs to a remote bridge.

#### Scenario: Configuration is applied to a local bridge

- **GIVEN** the user saves an allowed Prometheus URL for the local bridge
- **WHEN** the provider configuration is applied
- **THEN** the bridge uses the value for bounded provider refreshes and the
  browser continues to receive only the observability contract payload.

### Requirement: Report provider health

The Settings area SHALL show whether the configured provider is unavailable,
degraded, or available, including a concise reason and the most recent
successful observation time when one exists.

#### Scenario: Prometheus is down

- **GIVEN** a valid URL is configured but the Prometheus endpoint cannot be
  reached
- **WHEN** the provider refreshes
- **THEN** Settings reports degraded/unavailable state while Herdr sessions
  and the live Office remain usable.

### Requirement: Preserve startup compatibility

The implementation SHALL define precedence and migration behaviour between the
Settings value, `HERDR_WORLD_OTEL_PROMETHEUS_URL`, and any future bridge config
file before implementation is approved.

#### Scenario: Existing environment configuration is present

- **GIVEN** the bridge is started with the existing environment variable and
  no Settings value exists
- **WHEN** the application connects
- **THEN** the existing configured provider continues to work and the UI
  represents its source and editability without silently overriding it.

## 6. Data and interface contract

The provider continues to emit the approved observability descriptor and
snapshot contract. This feature adds configuration state; it does not add a
browser-facing Prometheus data contract.

The eventual implementation must specify:

- whether the value is global, per device, per bridge profile, or per host;
- whether applying a change is live, requires a bridge restart, or uses a
  bridge-owned persisted configuration file;
- environment-variable versus Settings precedence;
- how a bridge reports the effective source without exposing credentials; and
- how settings behave in the Android/native shell.

The current downstream slice uses browser local storage under
`herdrWeb.worldSettings.v1`, keyed by bridge profile ID. The bridge exposes a
small GET/PUT configuration route and owns the live provider instance; the
browser re-applies the stored value after a bridge reconnect. This is a
deliberately removable implementation seam rather than a generic Herdr Web
settings protocol.

## 7. Privacy and security

- URL validation MUST reject embedded credentials and unsupported schemes.
- The bridge remains responsible for backend access, query bounds, redaction,
  and provider failure handling.
- A remote bridge MUST NOT be reconfigured by a local browser unless its
  explicit origin, host policy, and authorization model admit that operation.
- Persisted settings MUST NOT contain provider credentials in this initial
  feature.
- Logs and diagnostics SHOULD avoid echoing full URLs when they may contain
  sensitive path or query components.

## 8. Acceptance evidence

Future implementation acceptance SHALL include:

- Settings UI tests for discovery, validation, save, clear, persistence, and
  error states;
- bridge/provider tests for effective configuration, precedence, and health
  reporting;
- security tests proving the browser cannot directly query Prometheus or
  reconfigure an unadmitted remote bridge;
- a live local-stack check showing Prometheus data on the Office metrics board;
- regression checks proving Herdr sessions and Office live state work with no
  provider configured; and
- updated startup documentation with one supported command sequence.

## 9. Deferred decisions

- The authoritative storage location and settings scope.
- Live bridge reconfiguration versus restart-required application.
- Whether the URL should be restricted to loopback/private networks or allow
  operator-approved remote endpoints.
- Authentication and authorization for bridge configuration mutations.
- Environment/config-file/Settings precedence and migration.
- Multi-bridge and Android/native behaviour.
- Whether the Settings area should eventually include other Office provider,
  freshness, cost, or display controls.
