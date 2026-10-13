# Ranger durable admission and recovery identity

## Intended behavior

Requirement: [durable task identity](../../openspec/specs/workspace-assistant/spec.md).
Owners: `server/src/assistant/context.ts`, `task-storage.ts`, `tasks.ts` and
`durable-storage.ts`; source PR #182. The owner authorized the bounded Ranger
implementation; its consumer/storage review and acceptance remain separate.

Committed task/run admission must survive reopening without changing captured
input, identity or running status. Failed SQLite writes must not leave partial
replacement state. Recovery checks endpoint fingerprint, Herdr boot identity and
workspace identity before obtaining a fresh runtime lease; matching transient
generation alone cannot authorize changed durable identity. Stable identity may
recover on a new generation. Recovery does not itself grant workspace permission
or promise exactly-once external actions.

## Model and implementation mapping

`ranger-recovery.qnt` tracks captured/saved/open/reopened state, the three independent
durable identities, generation 1/3 and recovery admission. `ranger-recovery.ts`
uses actual context scope/recovery checks and actual SQLite task storage/validation
in an owned synthetic directory. It saves one immutable admitted running task,
closes/reopens the database and checks exact retained task title/run status/targets.

The failure transition installs a real SQLite trigger that aborts insertion after
the transaction's deletes. A replacement title is valid input; the database must
roll back to the committed admission. This is a real mid-transaction failure,
not merely a schema rejection before writing. Endpoint/boot/workspace replacement
changes real provider identity; restoring original saved targets must reject it.
Stable identity recovery must return the actual fresh generation. Finally closes
storage and removes only its owned synthetic directory.

## Properties, witnesses and controls

`safety` prohibits recovery with changed durable identity. Actual per-seed witnesses
require stable/fresh-generation recovery, rejection of each identity replacement
and transaction failure. Five direct regressions combine rollback/reopen with all
identity cases. A model fault admits changed identity and must fail `recovery.result`.
A compiled storage fault removes the save transaction; the real SQL error then
leaves deleted state and must fail `recovery.persisted.task`. Unexpected SQL,
validation, filesystem or cleanup errors do not count as a fault kill.

## Storage and crash assumptions

The application uses private SQLite files, WAL and `synchronous=FULL`, with the
storage transaction as its commit boundary. This model assumes supported local
filesystem/SQLite semantics and exclusive service ownership; it does not prove
filesystem, hardware or power-loss behavior. Reopen and injected transaction abort
exercise committed state and rollback, not an actual power cut. Native storage
permissions, symlink/hard-link rejection, migration/corruption and lock-loss rollback
remain actual storage/durable-storage tests.

The real task scheduler and durable execution SDK own interrupted-run admission,
conversation replay, cancellation/drain and once-occurrence recovery. Existing
`tasks.test.ts` tests immutable durable admission and restart keeping one original
run, and `service.test.ts` tests confirmed task authority during cancellation.
These are separate required consumer mappings; the model does not label raw
reopened `running` state as automatically executed or authorized. Locks and SDK
transactions must remain owned through commit, as tested in durable-storage.
External side effects/notifications do not acquire exactly-once semantics from
SQLite admission. Their uncertainty/dedup/session tests remain necessary.

## Domain, evidence and review

One task and admitted run, two runtime generations, one change per durable identity,
bounded close/reopen/failed-save operations. Three seeds sample 500 paths and replay
100 per seed, up to 25 transitions; TLC checks finite safety. Run canonical checks
and real context/task/storage/service suites. Consumer and explicit storage/crash
assumptions await independent Ranger review; no spike acceptance is inherited.
