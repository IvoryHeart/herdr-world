# Durable Board concerns

Requirement: [World storage](../../openspec/specs/world-storage/spec.md), with
unchanged [identity policies](../../openspec/specs/world-identity/spec.md).
Q50 is candidate direct evidence; independent review and native CI are required.

Allowed: one worker stores separate Board concern rows and complete identity
captures in the same savepoint/transaction. The compatible document and note/Group
conflict responses remain unchanged. Cache, replies and events advance after
COMMIT. Independent edits accumulate; a refused patch changes nothing. Planning
callbacks read acknowledged state, recheck captured authority and conditional
undo never overwrites a later admitted edit. Native probes invalidated by a Board
edit are retried before move reconciliation. Close drains accepted writes.
Plans reserve retained input bytes before admission, including unvalidated RPC
params. Guard wrappers inherit reservations; accepted, refused, skipped and
uncertain outcomes release them while preserving delayed validation/authority.

Forbidden: optimistic publication, partial records/bindings, lost independent
edits, weakened runtime guards, stale-note overwrite, undo over a newer edit,
replayed import, overwritten backup, resurrected deleted notes, late writes after
close or database reopen from a closed read. Layout positions/pins/folds and
workspace/host colours must not create bindings or change native-reuse policy.
Runtime claims, configuration and secrets must not become Board records.

## Concrete evidence

- `storage/board-writer.test.ts` exhausts all 24 orders of independent note,
  appearance and refused edits against SQLite, then reopens each result. A SQL
  trigger refusal checks actual rollback of rows, reserved IDs and binding
  captures while neighboring accepted patches commit. Unchanged rows retain
  their row revision; layout preference rows have no binding.
- `service/board-storage.test.ts` exercises the real root and worker: exact
  private backup, once-only marker, unchanged source, committed cache, independent
  notes/stale-note conflicts, planning/CAS, malformed/conflicting-backup recovery,
  deletion without resurrection and a valid multibyte patch exceeding 4 MiB.
- `rpc/board-storage.test.ts` exercises commit/reply/event ordering, note/Group
  conflict wire responses, forbidden client operations and queued authority
  retirement with the real root. `world/board-storage-consumers.test.ts` exercises
  queued appearance edits during native moves and CLI history compensation
  racing an admitted browser edit.
- `storage/board-port.test.ts` compares explicit and guarded planning admission
  for four valid multibyte patches exceeding the queue budget in aggregate. It
  checks release after commit, no-op, revision mismatch, planning/write refusal,
  note conflict and uncertain outcome, and refuses an unmeasured callback.
  `rpc/board-admission.test.ts` reproduces that budget boundary through the actual
  deferred RPC path. Groups' eight browser viewports and the shared appearance
  desktop/phone browser exercise current HTTP-request predicates and the retained
  production guard.
- `storage/board-crash.test.ts` kills source and standalone compiled processes
  before/after write/import COMMIT and after worker acknowledgement. It checks
  complete records/bindings/ID reservations, marker atomicity, integrity, repeated
  recovery, 33-operation close drain and closed cached reads. The executable runs
  from an empty directory with its embedded worker and reports actual SQLite
  identity. Native installer CI runs this suite on Linux, macOS and Windows.
- Existing Board domain, recipient, Group, move, pruning, CLI authorization and
  browser consumers remain mandatory. Two actual services use distinct SQLite
  Board rows while keeping decoy HOME untouched. The verb registry and all six
  actor policies remain intact.

Real SQLite/process recovery is used instead of a new SQL state model: finite
operation permutations establish the ordering oracle, and actual worker/native
process schedules establish persistence. Existing binding and runtime models
remain required within their accepted scope. Run complete consumer files and the
unfiltered `bun run verification:gate`; focused cases are diagnostic only.
Assertion controls must fail a named assertion; a loader/parser failure does not
count as sensitivity evidence. Candidate controls break transaction-local reads,
import atomicity/idempotence/backup validation, RPC acknowledgement ordering,
conditional compensation and committed-only cache publication.

Excluded: physical power loss, arbitrary disk corruption, latency guarantees,
atomic external Herdr effects, persisted runtime claims or a new ID-creation
protocol. Existing browser-supplied note/string/Group IDs survive and are reserved
against future generated reuse. Native-keyed preferences deliberately retain their
existing identity boundary. Independent implementation/mapping review and native
CI acceptance remain separate from this local evidence.
