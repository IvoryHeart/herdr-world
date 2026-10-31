# Durable agent profiles and chimes

Requirements: [World storage](../../openspec/specs/world-storage/spec.md),
[terminal settings ownership](../../openspec/specs/world-surfaces/spec.md).
Q47 is candidate direct evidence; independent review and native CI remain required.

Allowed: one worker persists validated profiles and chimes; revisions and cached
reads advance only after COMMIT; independent edits accumulate within a group;
a refused edit rolls back only its savepoint. Existing profile IDs survive import.
The initial exact private JSON backup precedes atomic rows/completion. Missing
JSON seeds starters once. After initialization SQLite wins over every retained
JSON version, including malformed bytes. Config and secrets stay files.

Forbidden: optimistic profile publication, lost independent edits, partial import,
backup overwrite, import replay or starter resurrection, an acknowledged edit lost
on process restart, late writes after close, or a closed accessor reopening storage.
Legacy terminal import flags and the master revision watermark survive restart;
allocations increase atomically. Live assignments/master tokens remain Herdr-owned.
An async database wait cannot authorize a write through a retired runtime lease.

## Concrete mapping

- `storage/profile-writer.test.ts` exhausts all 24 orders of two independent
  profile edits, a chime edit and a refused edit against actual SQLite, then
  reopens each result. It checks import interruption, changed-source/deleted-starter
  idempotence and a conflicting preserved backup.
- `service/profile-storage.test.ts` exercises the real composition root and worker:
  byte-identical backup, unchanged source/marker, committed cache, concurrent edits,
  startup failure without partial rows, revision allocation/restart, retirement
  during a watermark commit and terminal-import completion across restart.
- `rpc/profiles-storage.test.ts` checks the actual RPC's reply/event boundary and
  refused-edit behavior with the real worker.
- `storage/profile-crash.test.ts` kills source and standalone compiled processes
  before/after edit and import COMMIT and after worker acknowledgement. It checks
  profile/chime/watermark/import state atomicity, integrity, restart, a 33-operation
  drain, closed cached reads and rejection of writes after close. The executable
  runs from an empty directory using its embedded worker, with no adjacent sources.
- Existing profile domain, launcher and terminal settings tests retain validation,
  credential refusal, Herdr ownership and two-World/two-host observation schedules.
  `service/storage.test.ts` retains root isolation and closed-family fences.
  `service/world-service.test.ts` exercises two actual services through HTTP/RPC,
  then checks their separate SQLite profile rows and an untouched decoy HOME.

Direct SQLite/process evidence is chosen instead of another finite state model:
a model cannot establish actual WAL/backup/worker recovery. The finite permutation
oracle addresses operation ordering; maintained runtime and binding models still
cover their unchanged contracts. Compiled assertion controls deliberately break
fresh reads, import atomicity/idempotence/backup verification, the RPC wait and
committed-only cache admission. Controls must fail a named assertion; loader or
parser failures do not count. Run the complete consumer files and the unfiltered
`bun run verification:gate`; focused cases are diagnostics, not acceptance.

Excluded: physical power loss/OS crash, arbitrary disk corruption, a timing SLA,
external token-write atomicity and a new profile-ID creation protocol. This
storage-only change preserves current browser-supplied IDs; reservations prevent
later generated IDs from reusing them, without claiming the unfinished profile
creation portion of the identity design. Runtime claims remain in memory and
runtime auto-sync status records belong to a separate migration.
