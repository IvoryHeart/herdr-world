# World storage

## Purpose

Keep World-owned questions, answers, results, attention intents, agent profiles,
chimes and auto-sync runtime status durable while retaining bootstrap configuration
and secrets as private files.

## Requirements

### Requirement: One asynchronous durable writer per instance

World SHALL place `world.sqlite` in its resolved instance data directory. All
database access SHALL pass through one in-process worker behind an asynchronous
port. The writer SHALL use WAL and synchronous FULL and refuse a second storage
opener. Group commit SHALL admit at most 32 operations or flush after an initial
5 ms scheduling delay, with bounded request, batch and admission bytes/counts.
Acknowledgement SHALL follow COMMIT. Time and scheduling SHALL be injected.

#### Scenario: Acknowledged answer survives restart
- **WHEN** the application is killed after acknowledging an answer
- **THEN** reopening the database returns that answer and its associated outbox

#### Scenario: A second writer attempts to open the instance
- **WHEN** a writer already holds the database open
- **THEN** another opener is refused and cannot mutate its state

### Requirement: Atomic records and declared attention

An ask/result mutation, ordered change reference and any declared attention
intent SHALL commit atomically. The outbox SHALL accept the declared recovery
classes keyed, reconcilable, reattachable, repeatable and opaque without
granting replay merely by storing a class. One owner-alert intent SHALL exist per ask;
retries SHALL be attempts on that row. Result recording SHALL retain its existing
behavior without introducing owner notifications. A database worker failure SHALL
reject pending outcomes as unknown and fail-stop the service for restart.

#### Scenario: Crash interrupts COMMIT acknowledgement
- **WHEN** the application dies before COMMIT or after COMMIT but before reply
- **THEN** recovery contains either the complete transaction or none of it
- **AND** recovery uses committed domain/outbox state without blindly resending
  an external effect

### Requirement: Explicit external-effect recovery

World SHALL persist dispatching before any attention send and turn interrupted
attempts into visible uncertain outcomes. Owner notifications MAY retry because
duplicates are harmless. Pane-answer attempts SHALL NOT automatically replay
after uncertainty. Herdr delivery SHALL NOT be described as deduplicated without
proven downstream support. Answer text SHALL remain available through ask get.
An owner alert SHALL use its captured connection's current runtime lease and
recheck currency; it SHALL never fall back to another connection. A pending alert
SHALL be cancelled when its ask closes. Definite disabled/no-foreground-client
refusals SHALL finish without retry; busy/rate-limited or missing-lease outcomes
SHALL defer with bounded backoff. A worker or process crash during dispatch SHALL
preserve explicit uncertainty. A failed recording request SHALL retain the
CLI's existing fallback owner alert and report the recording failure.

#### Scenario: Effect happens before its receipt is persisted
- **WHEN** a sender is killed after the effect but before recording its receipt
- **THEN** the attempt recovers uncertain
- **AND** an answer-pane attempt cannot be automatically claimed again

### Requirement: Idempotent private JSON migration

Before importing a changed configured legacy ledger, World SHALL preserve an
exact private backup named by content hash. Import of missing IDs and its hash
marker SHALL be atomic; unchanged second startup SHALL make no import writes.
Existing SQLite rows SHALL take precedence. Invalid legacy input SHALL remain
untouched and be reported while the current store starts; repaired input MAY
import on a later start. Historical import SHALL create no notification sends.
Future schema upgrades SHALL take a private consistent SQLite backup first and
reject a foreign application ID. Configuration and secrets SHALL remain files.

#### Scenario: Legacy JSON remains after import
- **WHEN** startup follows a completed import
- **THEN** it uses SQLite, performs no import writes for unchanged legacy input,
  and creates no historical alerts

### Requirement: Durable World-owned agent profiles

Agent profiles and chimes SHALL use the instance SQLite single writer through
the storage port. Existing validation, profile IDs and revisioned RPC behavior
SHALL remain compatible. Synchronous readers SHALL see only acknowledged commits;
concurrent operations SHALL read fresh transaction-local state. A refused edit
SHALL NOT undo another accepted operation in the same group.
Pending legacy terminal assignments, per-connection import completion and the
highest observed/written Town master revision SHALL persist in this family.
Master revision allocation SHALL be atomic. Live terminal choices SHALL remain
Herdr-owned, qualified by the current connection and generation.

Before the first profile import, World SHALL preserve an exact private
content-hash backup of the configured profile JSON. Domain rows and the import
marker SHALL commit atomically. Missing source SHALL seed starters once.
Malformed initial input or an unsafe/conflicting backup SHALL stop startup
without partial profile rows, leaving the source and preserved backup intact.
Once initialized, the family SHALL ignore retained JSON and SHALL NOT reseed
deleted starters, rewrite the source or repeat the import. Configuration and
secrets SHALL remain files. Close SHALL drain admitted profile writes, fence
later writes and retain committed cached reads without reopening storage.

#### Scenario: Concurrent edits and restart
- **WHEN** independent profile and chime edits share a group with a refused edit
- **THEN** accepted edits each advance the revision and survive restart together
- **AND** the refused edit has no durable effect or optimistic cached state

#### Scenario: Crash interrupts initial profile import
- **WHEN** the process dies before or after the import COMMIT
- **THEN** recovery has all profile rows and its marker or none of them
- **AND** retry completes once without modifying the retained source

#### Scenario: Retained JSON changes after migration
- **WHEN** an initialized family starts with changed or malformed retained JSON
- **THEN** it uses its committed SQLite profiles without import writes
- **AND** it neither restores deleted profiles nor repeats a completed terminal import

### Requirement: Durable auto-sync runtime status separate from configuration

World SHALL store auto-sync last-run time, outcome, message and branch in typed
SQLite rows behind the single writer and storage port. Rows SHALL retain existing
connection-qualified settings keys. Cached reads SHALL advance only after commit;
close SHALL drain admitted writes, fence later writes and retain cached reads.
The scheduler SHALL use committed last-run time for its existing interval policy
and await recording results. A retired scheduler SHALL NOT admit a late result.
Settings RPCs SHALL combine configuration with committed runtime status while
preserving existing fields and connection isolation.

Schedules, enabled flags, intervals, checkout/host configuration, custom settings
and secrets SHALL remain files. Runtime writes SHALL NOT rewrite configuration;
configuration writes SHALL NOT overwrite runtime rows. Before the first status
import, World SHALL preserve exact settings bytes in a private hash-named backup.
Only status fields and their completion marker SHALL enter SQLite atomically.
Missing source SHALL initialize empty history once. Malformed initial input or
an unsafe/conflicting backup SHALL stop startup without partial runtime rows.
Completed imports SHALL ignore all later JSON versions, without resetting history.
Pre-start CLI edits SHALL preserve legacy status until it can be imported; service
configuration writes after migration SHALL omit legacy status fields.

#### Scenario: A run completes while its schedule is toggled
- **WHEN** a current run records its result while a configuration RPC disables its schedule
- **THEN** the result and the disabled schedule both survive restart in their own stores
- **AND** the RPC reports the committed result using its existing wire fields

#### Scenario: Runtime status import is interrupted
- **WHEN** the process is killed before or after the import COMMIT
- **THEN** recovery has every imported runtime row and its marker or none of them
- **AND** retry imports once without modifying the original settings or copying configuration/secrets

### Requirement: Replay retention cannot resolve domain work

The change log SHALL retain at most 10,000 references and expire rows after 24
hours on writes; expired or previous-incarnation cursors SHALL explicitly require reset.
It SHALL scope cursors to the service incarnation and keep references/tombstones rather than duplicate
record bodies without a reader requiring them. Unanswered asks and unresolved
attention intents SHALL survive history pruning. A retained domain record SHALL
retain its finished attention evidence; trimming that record SHALL also trim its
finished attention rows. PR 1 SHALL create no answer-send backlog without a
consumer; the answer-delivery follow-up introduces that effect with its consumer.

#### Scenario: Replay expires while an answer is pending
- **WHEN** retention removes the creation replay entry
- **THEN** the open ask and unresolved intent remain durable and actionable only
  under their original dispatch rules

### Requirement: Drain and platform acceptance

Close SHALL stop admission, drain admitted operations and any final partial
group, close the worker and release handles before releasing instance ownership.
Unopened lazy families SHALL remain closed after close; SQLite accessors SHALL
NOT reopen the database, import JSON or run migrations.
Independent roots SHALL share no storage state. The compiled executable SHALL
embed its worker and require no adjacent source. Native Linux, macOS and Windows
crash tests SHALL report the SQLite identity actually used; process recovery
evidence SHALL NOT claim OS/power-loss durability.

#### Scenario: Close follows a partial group
- **WHEN** close follows already-admitted writes
- **THEN** all admitted writes complete before handles are released
- **AND** the same root can reopen in the same process

### Requirement: Store-checked short World IDs

New World records SHALL use a kind prefix and eight random base32 characters,
checked against existing IDs by the store. They SHALL contain no clock or
counter component. Imported record IDs SHALL remain unchanged. Restoring a
backup SHALL not restore a deterministic ID allocator that can retarget a late
answer to a different ask.

#### Scenario: Allocator draws an existing ID
- **WHEN** a generated ID already exists in the store
- **THEN** allocation draws another ID rather than replacing the existing record
