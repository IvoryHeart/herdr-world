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

The synthetic receiver persists across those reopens; fresh attempt fences and
its continuity contract do not prove native Herdr continuity. The additional
`world/effect-restart.test.ts` consumer reopens real SQLite with two distinct
actual ConnectionManager lifetimes that both produce generation 1, deliberately
reusing pane/terminal/reported-session/conversation evidence. Pending and claimed
alerts/answers refuse unsent; possible sends remain uncertain; explicit duplicate
approval cannot grant a replacement runtime authority. Same-run sends, retained
receipts/manual close and legacy missing-authority/migration cases are controls.
The pre-fix consumer failed six no-send assertions at actual receiver dispatch;
opaque automatic uncertainty and valid same-run controls already passed.
This direct consumer evidence is necessary because M5's synthetic continuity is
intentional; changing it would not establish the Herdr platform boundary.

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

## Agent bin: reversible departure and shared boarding clock

Allowed: Board, Desk and Town stage the same service-owned countdown; a drop
before pull-away resets every member of the waiting trip in full, even without
a browser join hint. A drop at/after pull-away waits for another trip. No intent
or native close exists before the countdown plus six-second departure ends;
hold freezes departure, and restore cancels it. Close now remains explicit and
run-scoped. Source replacement cannot grant the staged capture close authority.
Forbidden: an earlier rider closing on its old deadline after another drop;
recording a durable intent during reversible staging; per-view commit clocks;
resending a potentially applied close or inheriting another service's authority.

`server/src/world/bin-flow.test.ts` composes three actual browser stores with
production RPC, the registry, real SQLite worker/outbox and production closer
against a synthetic native source. Deterministic registry time checks each view
at one millisecond before expiry and at expiry, with durable outcome barriers.
Board drops without a join hint at 0:25, 0:11 and 0:01 retain the first rider
past its old deadline and close both on the new deadline; a drop at pull-away
does not reset the departing trip. Hold/restore leaves no intent and source
replacement refuses dispatch. `bin-close.test.ts` retains the independent
lane-discovery, shutdown, restart authority and lost-reply consumers from the
foundation; this composition does not replace them.

The actual Board browser case drops A at 0:30, advances to 0:25, drops B and
checks the shared full ring and both reset clocks. Town scene/browser cases
cover departure, hold, rescue, keyboard activation and reduced motion. A
boarding reset preserves the bus's set-off trajectory, including deceleration;
it can arrive early and wait until 0:00. The one-second-out regression checks
unchanged speed, arrival one second later and the remaining 29-second wait.

I1 retains historical R5: qualified staged, pending-admission and closing targets
all reserve their panes for pin admission. Native admission revalidates the
captured pin against current siblings and reservations; uncertainty retains a
reservation until fresh native absence/replacement or runtime retirement. RPC
tests hold native close and concurrent admission. Board and Desk browser tests
drive real cards/actions, hold the first sibling in closing after entries empty,
and refuse the last pinned sibling against unchanged two-pane topology. Desk's
browser case also exercises actual Close agent…, card drop, cancellation and
Put back; a direct store.add labelled desk is not its UI consumer.

I2's `bin-observers.test.ts` composes the registry with Town's production scene,
without private trajectory maps: a reset at 19 active seconds, a 60-second hold,
and one further active second preserve position, speed and early arrival.
Town's bus browser case fully remounts the component/layer from service-shaped
trip-clock samples after an approach reset, while held, and after a parked reset.
The service owns original duration and active elapsed time; layout geometry stays
in Town. These UI consumers do not replace the native source/stop fences.

These finite timing, RPC, SQLite and renderer boundaries use direct consumers
rather than a model that repeats the countdown implementation. M5's maintained
ordering/authority/recovery proof remains required in full. Synthetic source
and browser fixtures do not establish native Herdr execution or wall-clock
smoothness; source-bound isolated Herdr evidence and independent whole-PR and
consumer-mapping review remain separate acceptance requirements.
