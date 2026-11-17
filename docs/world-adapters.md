# Runtime observation adapters

Herdr is the only production runtime. The static registry in
`server/src/adapters/registry.ts` is imported by the service composition root;
it delegates runtime creation to the existing factory. There is no adapter loader
and no setting that enables test adapters. The WebSocket hello carries cloned
descriptors as data, without factories, configuration values or private credentials.
No browser presentation module is imported by the registry.

Descriptors identify the adapter kind and contract version (initially `1`), and
declare capabilities, object payload schemas, native key fields,
continuity fields, terminal support, verb input/output schemas and recovery classes,
an empty configuration schema, and acquisition limits. Secrets belong to the
existing private runtime configuration, outside this descriptor and observation port.
Increase the descriptor version when its advertised contract changes. Verb recovery
classes use the protocol vocabulary: `read`, `keyed`, `reconcilable`, `reattachable`,
`repeatable` and `opaque`. The four Herdr list verbs and synthetic `inspect` use
`read`; the registry preserves the descriptor version in the data sent by the hello.

## Herdr today

The observation wrapper uses the same concurrent `workspace.list`, `tab.list`,
`pane.list` and `agent.list` requests with 5-second timeouts. Required topology
failures still fail the snapshot; an unavailable agent catalogue still becomes
`null`. The production snapshot uses this raw wrapper, preserving all native
fields, projection, caching, admission, subscription and actionability behavior.

The new schema-admitted observation port describes a small topology projection:
workspace, tab, pane and agent IDs, labels, parent IDs and terminal/agent evidence.
Workspace and tab IDs alone provide no verified continuity. Pane and agent
continuity use `terminal_id` inside the runtime epoch supplied by the owner; an
empty or missing witness is unconfirmed. The owner must change that epoch on a
source reset or replacement. Herdr provides invalidating events, no source
revisions and no paginated native topology listing. An optional catalogue failure
makes the admitted listing incomplete, so it cannot end absent records.

This port declares only the four read-only list verbs. Existing browser and CLI
mutation routing and actor policies remain in their current dispatch tables;
their registry migration is task 7.1 of `world-protocol-identity`. GitHub and Jira
retain their current built-in source integration. This change does not migrate
their acquisition or add a second production runtime.

## Admission and ownership

`AdapterSession` is the provider-neutral acquisition boundary used by conformance.
It lazily opens enabled sources, installs an invalidation callback, coalesces
overlapping reads, reads pages sequentially and publishes a listing atomically.
Callers request a refresh on invalidation and for periodic repair; the boundary
owns no timers. Events carry no observations into this boundary. A missing event
is repaired by a later refresh; an event during acquisition leaves its result
unconfirmed until a subsequent clean refresh. Read failures retain display rows
but cannot confirm captures or emit current field claims.

Limits apply per session. Native request cost is charged for both concurrency
and rate: one Herdr page costs four requests. Pages, page size, total entities,
serialized acquisition bytes and retained rows/bytes are bounded. Rate excess is
refused without scheduling a retry. Retiring the session removes its watch and
discards late results. Callers retire the session when its owner ends.

Keys encode the source-instance, kind and case-sensitive native ID as a JSON
tuple. Epoch, continuity evidence and an observation-local lifetime keep a deleted
and recreated row separate even when its ID and witness repeat. Only complete
listings end absent rows; a reset ends the previous epoch even when the replacement
listing is partial. Unknown kinds and fields are ignored and counted. Unknown
kinds conservatively make the listing incomplete. Failed or inconsistent pages
publish nothing. Tombstones are capped at the entity limit; older captures become
unconfirmed after that horizon.

The capture check and per-field provenance records are boundary evidence, not
durable World IDs or a replacement for the stage-4 binding resolver and cross-source
claim display rules. Consumers must keep their declared lifetime policies when
they migrate. Undeclared verbs and invalid arguments fail before source acquisition.

## Conformance and the synthetic source

Run the shared suite and malformed-source controls with:

```sh
bun run test server/src/adapters/
HERDR_WORLD_LIVE_ADAPTERS=1 bun run test server/src/adapters/herdr.live.test.ts
```

The live check creates its own uniquely named `herdr --session`, waits for the
server's readiness message, creates one disposable workspace, observes it through
the adapter, and stops and deletes that session. It requires an installed Herdr;
ordinary CI skips this opt-in platform evidence.

The same shared suite runs against translated Herdr fixtures and the deterministic
test-only source in `server/src/adapters/testing/synthetic.ts`. Herdr fixtures
model optional catalogue failure as an incomplete listing; impossible native data
(unknown kinds and limit violations) is injected after native translation as a
fault control. The synthetic source uses separator-bearing, case-sensitive IDs,
two-row pages, partial listings, ID reuse across resets and payload-free events.
Its entities have no panes or terminals; field claims and continuity checks still
work, and terminal verbs are refused. Native snapshots retain their existing tests.

The release-entrypoint bundle test rejects synthetic registrations, implementation
code and eager browser presentation. The synthetic World subscription crossing is
a named pending test until v2 exists. It must cover terminal-less rows, ended
lifetimes on reset, reused IDs as new lifetimes, and no deletes from a partial list
before any consumer migrates to World subscriptions. See the current
[adapter contract](../openspec/specs/world-adapters/spec.md) and
[coverage decision](../verification/contracts/adapter-conformance.md).
