# Herdr observability extension boundary

Spec 002 establishes a downstream, upstreamable contract for optional
observability data. The first downstream provider now reads the existing local
Prometheus sink; Office rendering remains a separate consumer slice.

## Current implementation

The repository now contains:

- [`contracts/observability/`](../contracts/observability/), the language-neutral
  v1 schema and provider fixtures;
- `bridge/src/observability.rs`, the bounded provider trait, unavailable default
  provider, snapshot response, event sequencing, and resync boundary; and
- `bridge/src/observability_prometheus.rs`, the optional Prometheus read adapter
  for model, usage, and cost metrics; and
- `web/src/observability.ts`, the browser validator and transport client.

The bridge exposes the descriptor and snapshot at:

```text
GET /api/extensions/observability
GET /api/extensions/observability/snapshot
WS  /ws/extensions/observability
```

The default provider is explicitly `unavailable`, so normal Herdr World
snapshot, terminal, Spaces, and Office behaviour does not depend on an
observability backend. A provider failure becomes `degraded` with an empty
bounded snapshot rather than a page-level failure. Event gaps produce a
resync message; consumers recover by requesting a fresh snapshot.

## Local Prometheus provider

Enable the first provider by setting the bridge environment variable to an
operator-managed Prometheus-compatible HTTP API. For example, a local
deployment might expose that API on port `9101`:

```bash
HERDR_WORLD_OTEL_PROMETHEUS_URL=http://127.0.0.1:9101 \
  scripts/run-bridge.sh
```

The Office-only Settings surface can also configure this endpoint while the
bridge is running. Open Herdr World Settings, choose `Office`, and save the
optional Prometheus URL. The browser sends the value only to the selected
bridge's configuration route; it never queries Prometheus directly. The
setting is stored in browser local storage per bridge profile under the
`herdrWeb.worldSettings.v1` key, and is re-applied when that bridge reconnects.

The environment variable remains the startup default. If no Office setting
has been saved, it remains effective. Once an operator saves or clears the
Office setting, that per-bridge browser value takes precedence for that
browser. This live-configuration seam is downstream to this repository and
should be reviewed before proposing it upstream.

Optional settings are:

- `HERDR_WORLD_OTEL_PROMETHEUS_WINDOW_SECONDS` — usage window, defaulting to
  24 hours and bounded to 60 seconds–30 days;
- `HERDR_WORLD_OTEL_PROMETHEUS_REFRESH_SECONDS` — polling interval, defaulting
  to 30 seconds; and
- `HERDR_WORLD_OTEL_PROMETHEUS_MAX_MODELS` — model-row bound, defaulting to
  128.

OpenAI/Codex usage metrics do not currently include provider-emitted USD in
this sink. The bridge therefore applies a built-in, versioned standard API
rate card and marks those rows as estimates. To replace the defaults for a
deployment, provide a JSON object through
`HERDR_WORLD_OTEL_OPENAI_PRICING_JSON`:

```json
{
  "version": "my-openai-rate-card-2026-08-10",
  "fallback_model": "gpt-5.6-sol",
  "models": {
    "gpt-5.6-luna": {
      "input": 0.2,
      "cached_input": 0.02,
      "cache_write": 0.25,
      "output": 1.2
    }
  }
}
```

Rates are USD per one million tokens. The estimate uses uncached input,
cached input, cache writes, and output; reasoning output is retained as a
telemetry breakdown and is not added a second time. Unknown model names use
the configured fallback row and are marked `~` on the Office board. These are
API-equivalent estimates, not invoice, subscription, credit, or usage-limit
figures. The built-in defaults are based on the [official OpenAI API pricing
page](https://developers.openai.com/api/docs/pricing) and should be reviewed
when that pricing changes.

The adapter uses the existing sink and does not create a second export path.
It reports Claude usage and cost counters and Codex usage by model and usage
category. Results are aggregated by provider/model for the configured source;
they are not attributed to Herdr agents until an exact Herdr-to-telemetry
correlation key is available. Backend URLs, credentials, raw labels, session
IDs, and user identity fields never cross the bridge.

Office renders these aggregates on a separate `Economy` board beside the CEO
desk, with model, tokens, and cost columns. The `Workforce` board remains
separate beside the reception desks.

## Ownership and upstream PR seams

Office-specific configuration is intentionally kept outside the generic
Herdr Web settings implementation:

- `web/src/world/worldSettings.ts` owns the Office setting shape, validation,
  persistence, and bridge API calls;
- `web/src/world/WorldSettingsDialog.tsx` owns the Office settings UI;
- `web/src/world/officeObservability.ts` and `web/src/world/WorldSurface.tsx`
  own the Office health projection and presentation; and
- `web/src/App.tsx` and `web/src/BackendSettingsDialog.tsx` contain only the
  small entry-point/lifecycle seams needed to mount the Office slice.

The bridge-side dynamic provider seam is limited to the observability
extension files. Removing the Office-specific settings slice for an upstream
Herdr Web contribution therefore means removing the `worldSettings` module,
the Office dialog, its App/Settings entry points, and the configuration route;
the generic Herdr Web settings remain intact.

```text
observability contract  → schemas, versioning, validation, fixtures
provider adapter        → Collector/backend/project-specific access
Herdr Web bridge        → capability admission, transport, bounds, recovery
Office/World projection → presentation and navigation
distribution            → version pinning and component assembly
```

The first upstream-oriented contribution was the contract and fixtures,
reviewable without OTEL or Herdr Server changes. The Prometheus adapter is a
downstream contribution because its deployment, query API, retention, and
signal support belong to the existing sink. A Herdr
Server proposal, if accepted later, can provide equivalent data through the
same contract without importing Office code.

## Security boundary

The browser receives only validated, bounded contract payloads. Provider
credentials, backend URLs, connection strings, SSH keys, raw unbounded logs,
and arbitrary backend responses are not part of the browser contract. Remote
access remains governed by the existing bridge Host/Origin policy and
operator-managed SSH, VPN, TLS, firewall, or authenticated reverse proxy.

## Naming note

The product is Herdr World, with projections such as `Office`, `Graph`, and
`City`. Spec 002's observability contract remains independent of product
branding so a compatible provider can be implemented elsewhere.
