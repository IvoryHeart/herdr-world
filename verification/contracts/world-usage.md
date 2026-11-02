# World usage projection evidence

Requirement authority: issue #213 owner direction and the approved
[World usage delta](../../openspec/changes/harness-usage/specs/world-usage/spec.md).
This extends Q38's read-only numeric observation consumer, without changing the
accepted runtime lease or verb-policy models. The new mapping awaits the PR's
independent review; earlier Q38 acceptance does not accept this addition.

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
  ID allocation before storage closes.

## Direct evidence choice and bounds

Deterministic parser and service matrices exercise the actual numeric adapters
and all relevant lease transitions. A new state machine would duplicate a pure
projection while the existing runtime manager remains the source of lease
authority. Direct evidence is therefore selected; no expanded model proof or
new platform conformance is claimed.

`server/src/usage/projection.test.ts` checks response deduplication, cumulative
deltas, model changes, unknown baselines, counter decreases, invalid counters,
provider cache conventions, privacy sentinels and UTC boundaries.
`collector.test.ts` executes production projection against synthetic disposable
files, including duplicate sessions, incomplete writes, symlinks, compressed
rollouts, response validation, and the exact generated SSH program under Bun
and Node. `host.test.ts` checks qualified SSH selection, unavailable-source
behavior, unlinked Codex and changed terminal ownership.

`server/src/usage/service.test.ts` checks rollups, independent host identity,
duplicate/unlinked claims, lost sources, replacement during collection,
attribution invalidation, cache reuse, UTC reset, frame bounds, prices, optional
telemetry exclusion and service close. `server/src/rpc/usage.test.ts` exercises
the real dispatcher/verb registry, window validation, socket revocation and
absence of default-runtime routing.

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
