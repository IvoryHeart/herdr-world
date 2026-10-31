# Durable effect recovery (M5)

Requirements: [World effects](../../openspec/specs/world-effects/spec.md), design
section 12 of `world-protocol-identity`. Owners: the shared effects runner, SQLite
effect transitions, and the existing alert and saved-answer drivers. This is a
candidate expansion; the earlier accepted model boundaries do not approve it.

Allowed: same-key retry; decisive reconciliation; observing an existing external
run; repeatable alert duplicates; explicitly authorized possible duplicates;
release of undispatched claims; offline waiting; explicit version migration with
retained receipts/handles; completion evidence after cancellation or revocation.
Forbidden: blind opaque replay; relaunching a reattachable run; dispatch under an
unsupported version or retired fence; capturing a generation as the durable
target; reporting not-sent after any possible dispatch; migration replaying a
completed effect; age expiry of pending/uncertain work.

`effect-recovery.qnt` bounds one fully driven intent plus an independent peer
claim, five recovery classes, two attempts, two service incarnations, operation
versions 1/2, attached/offline/ended binding states, authorization and cancellation.
The peer verifies independent identity and compare-and-set admission rather than
duplicating the entire recovery state product. The generation deliberately stays
1 across restart; fresh service qualification must still be obtained. Safety
forbids automatic duplicate source effects except repeatable operations and
requires source application for a receipt. Phase/version/authority and retained
identity requirements are also checked at every real replay observation.

`effect-recovery.ts` holds the real runner at claim, committed dispatch and source
completion checkpoints. It drives actor/binding changes independently, releases
receipt completion, or abandons the continuation and reopens real temporary
SQLite. A second SQLite represents durable external application and source
receipts. The adapter compares actual phase, attempt, application count, receipt,
handle, version and peer claims after each transition. It never supplies model
outcomes to the implementation. Three seeds each replay 500 traces and require every named matrix witness
on actual production replay. The model's opaque-replay fault must violate safety
and be rejected by real replay. Compiled code controls must fail the planned
`effect.authorized`, `effect.receipt`, `effect.target` and `effect.notSent`
observations when authorization is skipped, keys change, a creation generation
is reused after restart, or possible dispatch is falsely reported as not sent. Unexpected parser, SQL, adapter and cleanup
errors never count as controls being killed.

`server/src/effects/recovery-matrix.test.ts` complements logical checkpoint replay
with real SIGKILL before/after COMMIT, after claim/dispatch/source/receipt and
during cancellation. Every design matrix row has a named source and standalone
compiled case, including permanent refusal, revocation, version migration and
completion retention. The suite started with 10 expected failures across the
missing recovery classes and after-dispatch cancellation before implementation
made them pass. Existing real Chat process tests remain required to establish the
late guarded input boundary and original session binding; a synthetic driver
does not substitute for those consumers.

P8 in `effects/admission.test.ts` advances deterministic wall time through early
wakes, backwards jumps and sleep across a persisted deadline. Admission tests
check late cancellation/revocation, stale attempt fences, indefinite offline
waiting and no false not-sent. Lint's own fixture proves direct and global-object
clock/timer access fails in the bounded core folders.

Run the complete `bun run verification:gate`, the complete effects tests and the
existing alert/answer/storage consumer files. Focused model runs are development
evidence only. The gate retains source/tool hashes, per-seed traces/witnesses,
model and implementation controls, exhaustive TLC exploration and enforced
resource accounting. SQLite replay has an explicit 480-second command bound
inside the unchanged 15-minute case/gate limits; other replay limits stay intact.
The initial shard timing records the observed 199.5-second complete-gate
effect-recovery case; it is not a test budget or latency promise.

Independent model/adapter, consumer and server query-contract acceptance remains
pending PR review. This evidence assumes local SQLite WAL/FULL semantics and a
source that honors its declared recovery contract. It does not prove power-loss
or filesystem safety, network delivery, source idempotency implementations,
external agent execution/reading, or temporal fairness. The unchanged platform
and native consumer jobs remain required.
