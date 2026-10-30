# World storage

## Purpose

Keep World-owned questions, answers, results and attention intents durable while
retaining bootstrap configuration and secrets as private files.

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
