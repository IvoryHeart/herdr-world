# Auto-sync runtime status storage

Requirements: [World storage](../../openspec/specs/world-storage/spec.md).
Q48 is candidate direct evidence. Independent review and native CI remain required.

Allowed: existing connection-qualified schedule keys address independent typed
last-run rows; one worker commits before cache/publication; refused operations
roll back independently. Import preserves exact raw bytes in a private backup,
then commits only status and its completion marker atomically. Missing source
initializes once. Completed initialization ignores retained JSON forever.

Forbidden: optimistic cached status, sibling-row loss, partial imports, backup
overwrite, config/custom/secrets in SQLite, new runtime writes to settings JSON,
configuration writes losing runtime results, post-close admission, or a retired
scheduler admitting a late result. Existing interval and explicit-force behavior,
connection isolation, dirty-tree refusal and Git effect checks remain mandatory.
Service Clock/Scheduler ownership extends through every connection runtime:
eligibility and persisted time use the clock; polling is cancellable and a late
callback from a retired start cannot clear a replacement timer or rearm work.

## Mapping and acceptance

- `service/runtime-status-storage.test.ts`: actual worker/root import, exact backup,
  committed cache, config/custom preservation, source exclusion, unchanged second
  marker, independent keys, a 33-write drain, close fence and restart. Invalid
  initial settings releases the worker and permits repair without partial rows.
- `storage/runtime-status-writer.test.ts`: all six orders of two independent rows
  plus a refused overwrite; reopen checks; atomic import interruption/retry;
  initialized-empty idempotence; malformed bytes and conflicting backup refusal.
- `workspace/auto-sync-storage.test.ts`: actual scheduler, settings RPC and real
  worker. Imported status supplies interval decisions; explicit force records a
  result; toggling configuration and reopening preserves status and RPC fields.
  The same checkout under a sibling connection stays isolated. Generic settings
  reads and repository-update replies retain their status fields too.
- `workspace/auto-sync-clock.test.ts`: real SQLite with virtual service time checks
  recent/not-due, due polling, force, exact persisted timestamps, repeated start,
  stop cancellation and late callbacks across stop/restart. Storage's batch timer
  is explicitly separate so worker acknowledgements use their ordinary drain.
  `service/world-service.test.ts` verifies the exact service clock/scheduler reach
  the actual connection-runtime constructor and retains shutdown tests whose
  deadline-expiry injection now begins only during shutdown.
- `workspace/auto-sync.test.ts`: retired Git/read work drains without admitting a
  late result; both connection namespaces remain isolated. Existing real Git
  branch/default/dirty-tree tests remain mandatory.
- `config/gui-settings.test.ts`: pre-start CLI edits preserve history for import.
  `http/auth-process.test.ts` retains authenticated name save/failure/retry with
  the write fault injected after import preflight.
- `storage/runtime-status-crash.test.ts`: twelve source/standalone compiled
  before/after import/edit COMMIT, worker-acknowledged process kill and partial
  queue drain cases. Reopen checks atomic rows, marker, integrity and closed cache;
  the executable runs alone with its embedded worker. Native installer CI repeats
  these schedules on its target SQLite.

Real SQLite/process recovery and exhaustive operation orders are chosen over a
new Quint model: a model cannot establish actual WAL/filesystem/embedded-worker
behavior. Existing runtime/binding models keep their fences; none is expanded by
this storage migration. Compiled assertion controls cover import atomicity,
idempotence, backup verification, cache timing, file separation, interval use and
RPC projection. Additional controls bypass eligibility time, persisted time,
poll scheduling, cancellation, generation-fenced timer ownership and root clock
wiring. Loader/parser failures do not count as a killed control.
Run complete consumer files, the applicable delivery checks and the unfiltered
`bun run verification:gate`. Existing accepted Q33 Git-action evidence is unchanged;
this new storage boundary requires separate mapping/implementation acceptance.

Excluded: physical power loss/OS crash, arbitrary disk corruption, a timing SLA,
exactly-once Git effects and atomic commits across Git and SQLite. A process can
fail after a Git effect and before its last-run result is recorded; this change
does not introduce effect replay or a workflow engine. Runtime field claims stay
in memory. Configuration and secrets keep their file ownership.
