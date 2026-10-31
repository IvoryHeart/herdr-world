# Durable identity and bindings

Requirement: [store-issued World IDs](../../openspec/specs/world-identity/spec.md).
Approved full design: `openspec/changes/world-protocol-identity`, task 6 and M4.
This first candidate covers the SQLite allocator, not source binding resolution.

Allowed: any earlier ID format preserved on import; global registry collision
retry; independent random allocation after restoring a stopped copy; permanent
reservations after trimming; unused reservations; refusal after close.
Forbidden: clocks/counters/native IDs used as new IDs; acknowledgement before
reservation commit; reuse after retention; collision checks limited to one
record family; import renaming an earlier ID.

## Implementation and evidence

`server/src/storage/world-ids.ts` is the worker-only registry and migration.
`WorldStorage.ids` exposes only asynchronous issuance, through the existing
bounded worker queue and per-operation savepoints. Ledger `nextId` consumers
await the same port; operation and outbox creation reserve in their domain
transaction. Migration and import triggers reserve existing IDs, answer
occurrences and historical references. None of these identities is authority.

`server/src/storage/world-ids.test.ts` drives real temporary SQLite writers and
the actual worker port. It forces collisions across imported and migrated
families, keeps IDs after record/history deletion and reopen, restores a stopped
database copy with fresh entropy, injects failures before and after COMMIT,
exhausts collision retries, and allocates concurrently through the worker.
Repeated ask upserts must preserve an already-reserved answer occurrence: a
parent UPSERT must not turn the reservation trigger's duplicate into a failure.
`world-identifiers.test.ts` checks symbol shape, collision retry and exhaustion.
`service/storage.test.ts` exercises the composition-root port and close fencing.
The existing complete storage, writer, crash, answer-migration and CLI suites
remain required consumers; import must not reinstate unverified answer evidence.

Direct SQLite integration and finite commit-boundary faults are selected over a
Quint allocation model: the actual database uniqueness, migration and worker
acknowledgement boundary are the relevant observations. This is not an exhaustive
proof of process/filesystem failures or random uniqueness. The tests use
deterministic eight-byte entropy for collisions and fresh production randomness
for the worker case. There is no claim about physical power loss, different
instances sharing IDs, or a restored copy's knowledge of discarded future IDs.

Two temporary production-code mutations are rejected by assertion failures in
the complete ID suite: ignoring the registry collision check (six tests fail)
and omitting the reservation insert (three tests fail). Parser/import failures
are not counted. The original source is restored after each control run.

## Pending boundary and acceptance

M4 binding-resolution, per-kind continuity/absence, ambiguity, field claims and
JSON-owned record migration remain outside this candidate. Board strings,
appearance, layout inheritance and transient marks retain their existing rules.
Those follow-up candidates must add the model/replay adapter, unchanged mandatory
consumers and negative controls and run the complete verification gate.

Run `bun run test server/src/storage/world-ids.test.ts`, the complete affected
consumer files and the applicable delivery gate. Independent PR review and CI
are required; the merged design is not implementation acceptance.
