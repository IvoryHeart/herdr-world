## Intended behavior and composition

Requirements come from the [delta spec](specs/herdr-core-runtime/spec.md), especially
ordered mirror recovery and original operation/occupant authority. Allowed:
ordered relative deltas; created/removed terminals; atomic missed replacement;
automatic existing-only reconnect; restart keeping addresses; source completion
without stale publication. Forbidden: stale callbacks rolling back a cut; dropped
deltas silently becoming current; actionability after unexplained gaps; replacing
an operation's lease/profile/session; blind replay of an unanswered opaque write;
source input reaching a kept replacement under the core-side Q3 assumption.
World must check occupant and foreground immediately before dispatch for every
harness. The later execution-time gate belongs to core: current core can deliver
a queued send to a replacement, so this model does not prove that race closed.
The ungated-queue mutant exposes that gap; it is not permission to add a World
harness side channel or gate read-write support on an upstream fix.

[The composed model](../../../quint/herdr-core-runtime.qnt) imports
`capturedLeaseCurrent` from `runtime-leases` and `opaqueReplayBlocked` from
`effect-recovery`. Those predicates also participate in the maintained foundation
models' capture/recovery transitions. Composition here shares those producer
rules at the consumer's admission/dispatch/recovery boundaries; it does not take
the Cartesian product of unrelated foundation administration/storage states.
The core model retains delayed operations and source-queued sends through
disconnect/restart/replacement. Foundation models and their real implementation
replays remain required in the complete gate.

## State and transition mapping

| State | Meaning and boundary |
| --- | --- |
| source, history, seq, epoch | Synthetic source truth at each sequence cut, independent of the mirror; one initially live address and one never-created address, with a born bit preventing address reuse; restart resets the process epoch/sequence while holders retain terminal facts. History is a specification oracle, never delivered with an event. |
| queue | Delivered/buffered events containing only operation, target and ordering identity. Relative x/y deltas cannot restore an earlier lost fact. Old callbacks remain queued after missed/reconnect. |
| mirror, cursor, ready | Admitted observation; baseline and missed replace it atomically. Receive/drop/heartbeat separate transport loss from detection. Non-actionable observation is retained. |
| owner, generation, connected, running | Two profiles on the same durable core; two transport attempts; absent endpoint. Connection identity cannot be replaced by durable core identity. No start operation exists in automatic connection. |
| leaseOwner/Gen/Epoch, captured, session | One original operation's immutable profile, runtime/epoch and occupant proof, retained after retirement. Capture, dispatch and publication are distinct transitions. |
| occupant, replaced | One kept replacement of terminal 0 without changing its address. It abstracts pid/argv/template/reported/foreground/session evidence changes, including reused-pid and in-shell replacements. |
| pending, queued, uncertain, attempts, delivered | Dispatch commits once; the source can execute later, even disconnected. The assumed core-side Q3 gate checks the captured occupant at execution; this is not a World harness channel. Completion only publishes under the original current authority. Recovery never blindly replays possible opaque writes. |

`projection` checks the exact mirror at its accepted source cut, including both
terminals, existence and independent facts. `safe` records admission, dispatch,
baseline postcondition, heartbeat retirement and late delivery validity at the
moment of each effect; later recovery cannot erase a violation. `attempts <= 1`
checks opaque replay. `running`/`connected` excludes auto-start or connection to an
absent endpoint. This is safety exploration without temporal fairness/liveness.

## Replay, witnesses and fault controls

[The replay adapter](../../../quint/herdr-core-runtime.ts) drives an in-process
protocol fake with real delta commands and immutable recipient capture. It uses
a keyed terminal map to apply changes, not the model's source-cut oracle. It checks
every observable state after each action. Decode, malformed state/action, process
and cleanup failures abort; only the named `core.state` mismatch kills a control.
Required replay witnesses cover ordered deltas, missed cuts, gap retirement,
reconnect, occupant refusal, late queued refusal and an absent endpoint per seed.

The maintained command checks all eleven plan mutants individually and requires
both an invariant violation and rejection of that counterexample by correct replay:

| Mutant | Forbidden outcome |
| --- | --- |
| keep-cursor | Restart baseline below the old cursor rejected |
| stale-after-missed | Old relative delta applied after the snapshot cut |
| replay-write | Unanswered possible write dispatched again |
| same-core-stale | Delayed operation dispatched through a new generation/epoch |
| profile-fallback | Profile A's work dispatched through B on the same core |
| lost-delta | Nonlast relative delta skipped while the cursor advances |
| gap-admitted | Later event applied over an unexplained missing delta |
| not-ready | Dispatch while the original connection is non-actionable |
| stale-session | Old session dispatch after replacement and fresh acquisition |
| ungated-queue | Queued source input delivered to a replacement occupant |
| heartbeat-ignored | Jump leaves the host actionable |

A separate ungated-fake control must diverge on a valid model trace. It checks
adapter sensitivity without claiming mutation of a production core provider.

## Production mapping (issue #865)

The replay adapter now feeds World's production `CoreMirror`
(`server/src/herdr-core/mirror.ts`) the same subscribe snapshot, event,
`missed` and heartbeat lines a core sends, and projects its terminals, cursor
and actionability onto the model's `mirror`, `cursor` and `ready`. Each
connect is a fresh production subscription. Values carried by an event are
the source's at emission, as core sends whole records and label maps; removed
terminals have no observable facts, so their retained model values come from
the cut. The adapter still simulates the source, its queue and the delayed
operation, and `replace` withdraws readiness as the model abstracts it
(production sees a kept replacement as `lost` and `restarted` events that
change the occupancy token).

Four production negative controls bundle a mutated mirror and must each be
rejected by a valid trace through `core.state`: a gap admitted, a heartbeat
jump ignored, a stale event applied and a `missed` cut ignored. Receive-side
gaps are rare under sampling, so the runner also searches for a valid witness
(`noReceiveGap` violated) and replays it with correct and mutant mirrors.

World's views (issue #866) read core through the production read model
(`coreReadModel`, `server/src/herdr-core/topology.ts`), the rows Town, Desk,
Board and Needs you are built from. After every replayed transition the adapter
reads it against the same production mirror: while the model is `ready` it
must list exactly the model mirror's live terminals, and otherwise it must
refuse, so a retired or unbaselined observation is never shown as current
(World shows the last facts only as stale). A fifth production negative
control, a read model that ignores actionability, must be rejected through
`core.view`. The view is a function of `ready` and `mirror`, so the model needs
no new action; status words, harness names, placement and World's first-sight
seen rule are display data with unit and recorded-traffic tests, not model
claims.

Capture, dispatch and delivery remain the design seam. The model's dispatch
checks the source's actual occupant; World can check only its observation,
which may lag a queued removal or replacement. Mapping the production
`CoreOperationFence` therefore needs the model to separate the observed
occupant at dispatch from the actual one at core's input boundary (where the
owner rulings place the queued-send window, upstream Q3). Until then, fence
behaviour is checked by unit and integration tests, not by this replay.

World's float shell (the room shell that replaces Herdr Float on core) adds no
model action. Its run, attach and end go through the same `CoreOperationFence`
(lease, generation and core process at dispatch and publication; the program
occupant for end, deliberately not its foreground), so it inherits this seam
and its tests. One shell per room is core's own live-name uniqueness, observed
by World rather than decided by it; the first paint waiting for the open reply
and credit returned only as a browser drains are one socket's framing and flow,
outside this model's claims. `float-shell.test.ts` injects each fault
(`kill -9` mid-stream, EOF, a split UTF-8 character, an oversized `missed`,
exhausted credit, a replaced occupant, a foreign terminal holding the name) and
`core.live.test.ts` repeats the flow against the release.

## Bounds, evidence and acceptance

The single module has two explicitly bounded schedule families. Ordering explores
two independent source deltas, created/removed terminals and recovery. Authority
interleaves one source delta with the delayed operation, profile switch and kept
replacement. This avoids multiplying irrelevant data permutations into every
operation state; it does not claim arbitrary two-delta/operation schedules.
Both families have two terminals, independent integer x/y facts, two connection
attempts, two profiles sharing one core, one process restart, one replacement,
one captured operation and one source queue. Created/removed events and delayed
callbacks are explicit. TLC explores the reachable bounded state graph after quotienting replay-only
action/target labels and admitted/dispatched/published receipts. None of those
fields participates in a transition guard or safety invariant; all authority,
source state, cuts, pending work and safe-effect history remain. Sampling weights
favor the queued-replacement race without adding or removing any transition.
Three
seeds (42/73/103) sample 500 traces of up to 25 transitions each, all replayed.
Fault searches use 10,000 samples with seed 42 and the same transition bound;
missing counterexamples fail. Increasing source changes to three adds 100 replayed sensitivity traces.

Run `bun quint/run.ts --case herdr-core-runtime` for development and
`bun run verification:gate` for complete canonical evidence. The maintained runner
retains source/model/adapter/tool hashes, command logs, traces and counterexamples
in ignored verification artifacts with existing deadlines and process cleanup.
Unit tests exercise fake transition/rejection and trace validation independently.

This is a P0 design contract with independent review pending PR review. The
ordering/recovery transitions replay against the production mirror (above).
The model makes no claim about framing/credit/UTF-8/budgets (they have unit,
recorded-traffic and live-release tests instead), actual core release behavior, every
occupant-evidence detector, SQLite persistence, core send/keys integration or the
upstream Q3 execution-time fence, OS/SSH/Windows named pipes, app placement/seen, browser grids, performance or
temporal recovery. P1–P6 consumer/platform checks in [delivery](delivery.md) remain
mandatory before their paths ship. Do not promote a fake into production evidence.
