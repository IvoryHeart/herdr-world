## Purpose

Provide the paradigm-neutral substrate that durable work needs, without choosing a
workflow authoring model:
- intents and effects through a transactional outbox;
- fenced attempts and recovery by effect class;
- a durable inbox for signals;
- pinned operation versions;
- durable deadlines, read through injected clock and scheduler ports.

## ADDED Requirements

### Requirement: Intents through a transactional outbox

World SHALL record each durable effect as an intent before dispatching it. A durable
effect is one that must survive a service restart, or be queued, scheduled or retried.
The intent SHALL be committed in the same transaction as the domain change that
requires it.

An intent SHALL record:
- its verb and validated parameters;
- its targets, as bindings rather than runtime fences;
- its actor and authorization evidence;
- an idempotency key;
- its operation version;
- its preconditions;
- an opaque origin supplied by its creator.

Dispatch SHALL happen only from committed intents. Interactive commands that need not
outlive the request SHALL keep their direct path and existing uncertainty rules.

#### Scenario: Crash after commit
- **WHEN** World commits a domain change and its intent, then stops before dispatching
- **THEN** after restart the intent is still pending and is dispatched only after its
  checks pass

#### Scenario: Failed commit
- **WHEN** the transaction holding a domain change and its intent fails
- **THEN** neither the change nor the intent exists, and nothing is dispatched

### Requirement: Fenced dispatch attempts

At most one attempt per intent SHALL be active. An attempt SHALL be claimed with a
fence naming the service incarnation and an attempt number. Immediately before
dispatch, World SHALL recheck all of these:
- the actor's current authorization;
- the intent's preconditions;
- the attached state of its bindings, resolved to a fresh qualified target;
- support for its operation version.

A committed intent or a claimed attempt SHALL NOT preserve a permission that has since
been revoked. World SHALL durably mark an attempt as dispatching before dispatching it,
and SHALL record its receipt, refusal or uncertainty afterwards.

#### Scenario: Claim left by a stopped process
- **WHEN** World stops after claiming an attempt but before marking it dispatching
- **THEN** the next incarnation does not honour the old claim, and claims a new attempt
  after rechecking authorization

#### Scenario: Two dispatchers
- **WHEN** two dispatch paths try to claim the same intent
- **THEN** exactly one claim succeeds and the other dispatches nothing

### Requirement: Recovery by effect class

When an attempt may have dispatched and its outcome is unknown, World SHALL recover by
its verb's recovery class:
- **keyed**: retry with the same idempotency key, and record the receipt;
- **reconcilable**: read the source decisively first. Record success if the effect
  happened; dispatch again only if it did not;
- **reattachable**: find the existing run by its external handle, and reattach and
  observe it. Never relaunch it;
- **opaque**: mark the intent uncertain and show it. Never retry it automatically, and
  wait for an authorized decision.

A permanent refusal SHALL be recorded with its reason and SHALL stop further attempts
until it is resolved. World SHALL NOT claim exactly-once delivery for any class.

#### Scenario: Opaque effect after a crash
- **WHEN** World crashes after dispatching an opaque effect and before recording its
  outcome
- **THEN** after restart the intent is shown as uncertain and is not dispatched again
  without an authorized decision

#### Scenario: Reattachable run
- **WHEN** World crashes after starting an external run whose handle it recorded
- **THEN** after restart it finds and observes that run instead of starting another

#### Scenario: Reconcilable effect already applied
- **WHEN** a decisive read shows a reconcilable effect already happened
- **THEN** World records success and does not dispatch again

### Requirement: Cancellation and revocation

**Before dispatch.** Cancellation, or the revocation of a permission, confirmation or
required capability, SHALL:
- fence the queued attempt, so that no forbidden effect starts;
- record the reason;
- release any reservations the intent held.

**After dispatch.** World SHALL record the effect's real outcome. It SHALL offer only
cleanup that is supported and currently authorized, and SHALL NOT claim the effect was
undone.

#### Scenario: Cancel before dispatch
- **WHEN** the owner cancels an intent whose attempt is claimed but not yet dispatching
- **THEN** no effect starts and the intent records its cancellation

#### Scenario: Revoked during a wait
- **WHEN** a permission is revoked while its intent waits to be dispatched
- **THEN** the intent is not dispatched and records the revocation

#### Scenario: Cancel after dispatch
- **WHEN** the owner cancels an intent whose effect was already dispatched
- **THEN** World records the effect's actual outcome and offers only supported,
  authorized cleanup

### Requirement: Durable inbox for correlated signals

World SHALL store each incoming signal, such as an answer or an observed external event,
durably and exactly once by its dedupe key, before acknowledging its sender. It SHALL
correlate the signal to one exact occurrence. It SHALL keep the signal until a consumer
resolves it, including a signal that arrives before anything waits for it. A duplicate
signal SHALL be acknowledged without being stored or acted on again.

#### Scenario: Answer before the wait
- **WHEN** an answer arrives before the work that needs it has registered its wait
- **THEN** the answer is kept and is delivered when the wait is registered

#### Scenario: Duplicate answer
- **WHEN** the same answer is delivered twice
- **THEN** it is stored once and acted on once

### Requirement: Pinned operation versions

Each intent SHALL name the version of the operation contract it was created against. A
service that does not support that version SHALL mark the intent as needing migration
and SHALL NOT dispatch it. The intent SHALL keep its inbox signals and receipts. A
migration SHALL be an explicit, recorded transition. It SHALL NOT replay an effect that
already completed, and SHALL NOT lose an external handle.

#### Scenario: Old intent, new binary
- **WHEN** an upgraded World finds a pending intent whose operation version it no
  longer supports
- **THEN** the intent is marked as needing migration, nothing is dispatched, and its
  signals and receipts are kept

### Requirement: State-conditioned queued intents

Only verbs that declare themselves queueable SHALL be queued for later dispatch. A
queued intent SHALL capture the target state it was made against. When it can next be
dispatched, World SHALL:
- dispatch it if that state is unchanged, however much time has passed;
- otherwise record it as not sent because the target changed.

No expiry timer SHALL remove a queued intent. Terminal input and Chat sends SHALL NOT be
queueable.

#### Scenario: Unchanged target on reconnect
- **WHEN** a host reconnects after a long outage and a queued intent's target state is
  unchanged
- **THEN** the intent is dispatched

#### Scenario: Changed target on reconnect
- **WHEN** a host reconnects and a queued intent's target state has changed
- **THEN** the intent is not sent, and records that its target changed

### Requirement: Durable deadlines and injected time

Substrate logic SHALL read time and defer work only through the service's injected
clock and scheduler. The clock SHALL provide wall time for timestamps and deadlines, and
monotonic time for in-process waits.

**Durable deadlines.**
- A deadline SHALL persist its wall time.
- It SHALL fire only once the wall clock has reached it. A wait that wakes early SHALL
  be re-armed.
- A deadline that passed while World was stopped SHALL fire once on start, after its
  authorization is rechecked.

**Tests.** Deterministic clock and scheduler substitutes SHALL be able to drive this
behaviour without real time.

#### Scenario: Deadline passes while stopped
- **WHEN** a durable deadline passes while World is stopped
- **THEN** it fires once after the next start, after its authorization recheck

#### Scenario: Early wake
- **WHEN** a scheduled wait wakes before its wall deadline, for example after a clock
  change
- **THEN** the deadline does not fire and the wait is re-armed

### Requirement: Retention of pending work

World SHALL keep each of these until its explicit resolution, whatever its age:
- unanswered asks;
- unmatched early signals;
- pending and uncertain intents;
- the receipts needed for idempotency or uncertainty recovery.

No age-only rule SHALL remove them. Business deadlines and cancellation SHALL be explicit
policies, separate from history retention.

#### Scenario: Old pending ask
- **WHEN** an ask stays unanswered past any history retention window
- **THEN** it remains answerable, and its correlation and receipts are kept
