# World usage projection evidence

Requirement authority: issue #213 owner direction and the approved
[World usage delta](../../openspec/changes/harness-usage/specs/world-usage/spec.md).
This extends Q38's read-only numeric observation consumer; accepted runtime lease
and verb-policy models continue to supply operation authority.

## Properties derived before implementation

- A repeated source response contributes once. Cumulative Codex counts contribute
  only a known nonnegative delta; unknown initial baselines cannot be assigned
  wholesale to the latest model or current day.
- Disjoint input/cache/output counters sum once. Reasoning remains a subset of
  output. Invalid or absent values are unknown coverage, never invented usage.
- Only one current qualified session/file binding can name pane, tab and
  workspace. Unknown/duplicate claims remain host-level; replacement runtimes
  never publish a retired collector's fresh result.
- Source failure preserves explicit stale evidence outside fresh totals; empty
  observations with missing sources do not prove zero spend.
- A building total is no greater than the city total for the same observation;
  host totals sum to the city. Unattributed is a subtotal, not an added charge.
  Detail/frame clipping cannot reduce collected balances or erase valid bindings
  solely because log coverage is partial. Activity-title changes without a session identity change do not change claims.
- UTC query boundaries reset today and preserve the bounded seven-day rollups.
  Seven days includes today from the same observation; Town's Economy and city
  Today share this observation and the exact-model local pricing rule.
  Source and response capacity limits disclose truncation and preserve frame
  admission. No raw content, native session IDs, paths or errors enter output.
- Unknown prices preserve tokens and null estimates. OTel comparison data cannot
  change canonical log totals without disjoint-scope/event identity evidence.
- Subscription limits are the newest numeric Codex `rate_limits` observation per
  host: window length, percent used, reset time and observation time only. Plan,
  credits, limit names and other limit IDs never leave the host. A failed read
  keeps the last observation as stale; an observation past a window's reset or
  three hours old is stale; no observation is missing, never zero or full.
  Claude's observation is the newer of World's status line tap reading
  (numbers only, a small regular file below the host user's home) and a
  transcript refusal (`usage_limit_reached` with a reset time), which reads
  "limit reached" without a percent and is stale once its reset passes. The tap
  is added per launch with `--settings`, never written to Claude settings
  files, and passes the user's own status line output through unchanged.
- A pane's context fill is the newest main-thread prompt size of the one
  session uniquely bound to it on a fresh read, with the harness's reported
  window or a model-name table. Numbers, the exact model and digests only
  leave the host; an unknown model, or one whose window the log cannot settle,
  has no window, and duplicate claims, stale
  hosts or retired generations produce no entry rather than zero.
- Closing the service drains its collectors and fences further publication and
  resources before storage closes; reads never allocate durable identity records.

## Direct evidence choice and bounds

Deterministic parser and service matrices exercise the actual numeric adapters
and all relevant lease transitions. A new state machine would duplicate a pure
projection while the existing runtime manager remains the source of lease
authority. Direct evidence is therefore selected; no expanded model proof or
new platform conformance is claimed.

- `server/src/usage/projection.test.ts`: response deduplication, cumulative
  high-water recovery, model/cache conventions, unknown baselines and UTC bounds.
- `collector.test.ts`: synthetic production parsers, copied preambles,
  retryable complete-line offsets, bounded continuity samples/daily rebuilds,
  parser/cursor budget recovery, bounded cache eviction, newest-first admission,
  verified-descriptor containment, old-date activity and conservative
  prefix ambiguity across current and older evidence. Generated programs also run
  under Bun/Node and after minified bundling.
- `reader.test.ts`, `process.test.ts`, `host.test.ts`: persistent host-owned local
  and SSH caches, stdin request privacy, exact host selection, incomplete claims,
  cancellation/deadline termination, stream overflow, invalid/idle reply failure
  teardown and exit/reap ownership.
- `summary.test.ts`: maximum 16-host/128-pane/seven-day frame clipping preserves
  city, host and today balances, including disjoint cache/reasoning counters.
- `web/src/world/town/townEconomy.test.ts`: shared-window refresh, UTC rollover,
  pricing reasons, building partitions and fixture/board agreement.
- `service.test.ts`: host isolation, rollups, unique complete revalidation, lease
  replacement, stale/missing sources, windows, deterministic IDs without writes,
  estimates, telemetry exclusion, frame limits and shutdown.
- `limits.test.ts`: Codex limit parsing (null secondary, missing and malformed
  windows, foreign limit IDs, future timestamps), newest-per-host collection
  locally and through the SSH program, remote reply validation and staleness;
  Claude refusals (cancelled by a later answer, malformed and future-dated
  records, no account fields) and the tap reading versus refusal precedence,
  including rejected and symlinked readings, locally and over SSH;
  `service.test.ts` covers per-host limit states and failed-read retention.
- `context.test.ts`: per-harness prompt sizes (sidechain, API-error, synthetic
  and future records skipped; an older line never wins), the model-window
  table, collection locally and through the SSH program, and remote reply
  validation; `service.test.ts` covers unique fresh attribution, unknown
  windows, duplicate claims and failed hosts.
- `claude-tap.test.ts`: the tap records only numbers, finds the user's status
  line by Claude Code's precedence without recursing, and as a real program
  passes the same input to it and its output and exit code through unchanged;
  Claude launches alone get the per-launch settings.
- `server/src/rpc/usage.test.ts`: real verb admission, window validation, socket
  revocation and absence of default-runtime routing.
- `server/src/bridge/herdr-client.test.ts`: cancellation destroys the owned
  one-shot socket; a pre-aborted read opens none.

Run the complete consumer set with:

```bash
bun run test server/src/usage server/src/rpc/usage.test.ts web/src/world/town/townEconomy.test.ts web/src/world/town/townExpenses.test.ts web/src/world/town/townPlaceSummary.test.ts
```

Existing runtime, service shutdown, OTel and verb consumers remain mandatory.
The shared pre-push gate runs the selected non-browser consumers and static
checks; CI retains the required complete behavioral verification selection.
Tests do not establish live SSH fleet availability, arbitrary future harness
schema compatibility, synchronized source clocks, full history beyond budgets,
actual provider charges or performance deadlines on every host.
