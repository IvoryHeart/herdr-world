# Durable asks and attention recovery

Requirements: `openspec/specs/world-storage/spec.md`. This supplements the Q29
notification assessment with a candidate, without expanding accepted Quint or
consumer claims. Independent review and the complete applicable delivery gate remain required.

Allowed: atomic domain/declared-outbox commits; post-COMMIT acknowledgement;
one worker owns the database; explicit uncertainty after interrupted dispatch;
safe owner-alert retries with bounded backoff; cancelled alerts when asks close;
pending work surviving history expiry; dispatcher drain before connection/storage
shutdown; fail-stop after worker failure.

Forbidden: acknowledged answers lost on application crash; partial domain/outbox
commits; a second active writer; repeated definite-refusal alerts; retries after
ask closure; silent uncertain pane replay; routing to another connection;
unchanged JSON import writes; retention removing unresolved work; a compiled
executable requiring adjacent worker source; unused answer-send backlogs.

Finite schedules in `world-storage-crash.test.ts` kill real
source and standalone compiled processes before/after COMMIT, after a worker
acknowledgement, and around a synthetic external effect/receipt. These schedules and the partial-queue drain are maintained acceptance evidence. `world-writer.test.ts` must cover operation/savepoint isolation,
both history bounds, service-incarnation cursor reset, attempt fencing, all five
protocol recovery classes and safe re-upgrade after restoring a migration snapshot.
`world-storage.test.ts` must cover exclusive ownership, isolated roots, reopen,
hash-named private import backup, changed-source missing-ID merge, malformed
legacy input and recovered uncertainty.

`attention-dispatch.test.ts` must check claim commit before Herdr, final versus
temporary refusals, bounded backoff, closed-ask cancellation, lease retirement,
notification rebinding only on the original connection and own-ask response
isolation. CLI `world.test.ts` must preserve fallback when recording fails and
report the service's actual alert outcome and retry status when recording
succeeds. Integrated root tests must fail when dispatch outlives storage or a
worker fault leaves a service running with a dead ledger.

Run the complete maintained test files, not filtered cases, and the full
applicable delivery/behavioral gate. Native installer CI repeats storage recovery
on each supported target and records its actual SQLite identity. The synthetic
receiver records operation IDs durably; deduplication belongs only to that
receiver. Current Herdr `agent.prompt` and `notification.show` expose no such key.

The retained source/compiled tests are concrete platform alternative evidence.
A Quint model alone cannot establish WAL/filesystem recovery or downstream
deduplication. Scope remains finite process-fault schedules, not a formal proof
of every possible disk/process/receiver failure.

Excluded claims: physical power-loss/OS-crash safety, native-memory-fault
isolation, a latency SLA, downstream execution/read exactly once, and automatic
pane-answer delivery. The latter is the planned `docs/ask-answer-delivery.md`
follow-up; its identity, CLI-receipt and owner-recovery cases are not counted as
executed coverage. Prior draft passes do not establish the reviewed repairs.

`world-identifiers.test.ts` checks store collision rejection and eight-symbol
base32 IDs without clocks/counters. `service/storage-lifecycle.test.ts` checks
independent roots, actual worker-loss signaling and root fail-stop. The root's
`world-service.test.ts` retains its public HTTP/WebSocket two-root isolation
checks and inspects the persisted SQLite family after close. Reception unit
coverage retains question counts, shows failure/uncertainty and consumes a newer
query revision for delivery-only evidence. Ordinary successful markup stays
unchanged. Native/platform and independent review acceptance remain separate.
