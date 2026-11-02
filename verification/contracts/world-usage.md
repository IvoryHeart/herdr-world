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
- UTC query boundaries reset today and preserve the bounded seven-day rollups.
  Source and response capacity limits disclose truncation and preserve frame
  admission. No raw content, native session IDs, paths or errors enter output.
- Unknown prices preserve tokens and null estimates. OTel comparison data cannot
  change canonical log totals without disjoint-scope/event identity evidence.
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
  incremental complete-line offsets, rewrite invalidation, bounded cache eviction,
  newest-first admission, root/extension containment, date pruning and conservative
  prefix ambiguity across current and older evidence. Generated programs also run
  under Bun/Node and after minified bundling.
- `reader.test.ts`, `process.test.ts`, `host.test.ts`: persistent host-owned local
  and SSH caches, stdin request privacy, exact host selection, incomplete claims,
  cancellation/deadline termination, stream overflow and exit/reap ownership.
- `service.test.ts`: host isolation, rollups, unique complete revalidation, lease
  replacement, stale/missing sources, windows, deterministic IDs without writes,
  estimates, telemetry exclusion, frame limits and shutdown.
- `server/src/rpc/usage.test.ts`: real verb admission, window validation, socket
  revocation and absence of default-runtime routing.
- `server/src/bridge/herdr-client.test.ts`: cancellation destroys the owned
  one-shot socket; a pre-aborted read opens none.

Run the complete consumer set with:

```bash
bun run test server/src/usage server/src/rpc/usage.test.ts
```

Existing runtime, service shutdown, OTel and verb consumers remain mandatory.
The shared pre-push gate runs the selected non-browser consumers and static
checks; CI retains the required complete behavioral verification selection.
Tests do not establish live SSH fleet availability, arbitrary future harness
schema compatibility, synchronized source clocks, full history beyond budgets,
actual provider charges or performance deadlines on every host.
