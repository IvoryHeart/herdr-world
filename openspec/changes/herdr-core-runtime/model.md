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
| foreground | Whether current foreground evidence is present; loseForeground models a missing read, dispatch refuses it even with an otherwise current occupant. |
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

The maintained command explores all nineteen mutants (fourteen plan mutants and
five observe mutants, below) individually with TLC and requires
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
| missing-foreground | Dispatch with missing foreground evidence |
| ungated-queue | Queued source input delivered to a replacement occupant |
| heartbeat-ignored | Jump leaves the host actionable |
| unconfirmed-cascade | Kill sent while an observed die-with-parent child is unconfirmed |
| stale-confirmation | Kill sent after the confirmed program was replaced |
| interactive-attach | World's watch leads core's size, as a typing viewer would |
| unconfirmed-accepted | A path without confirmed resize notifications is watched |
| paint-before-resize | A paint is drawn before the grid core announced for it |
| stale-stream | Frames of an ended watch reach the new one |
| observer-input | A rotation or keyboard sends core input, size or focus |

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

## Kill confirmation (issue #869, M7)

The authority family chooses at init whether terminal 1, once created, is a
child core ends with terminal 0 (`child`). `plan` records what World's
production plan names from its mirror (`confirmedChild`, `confirmedOccupant`);
`kill` plans again from the current mirror and is sent only while it is ready,
the terminal is live, no observed child is unconfirmed and the occupant is the
confirmed one. A sent kill ends terminal 0 and the child as a silent source
change that withdraws readiness, as `replace` does. `safe` holds over World's
observation: a child core creates after World's last applied event is outside
this fence, since core has no conditional kill (upstream Q11), like the Q3
queued-send window. A sampling-only weight (`childAfterPlan`) creates the child
after planning; it adds no transition. Naming what core's cascade ended beyond
the confirmation (`coreKillUnconfirmed`) is a report after the kill, not a
decision, so it adds no action either; `operations.test.ts` and
`bin-close-core.test.ts` drive it with a child core creates while it handles
the kill, and a child that had ended before it is never named.

The replay adapter decides `plan` and `kill` with the production
`coreKillPlan` and `coreKillRefusal` (`server/src/herdr-core/kill-plan.ts`) over
the production mirror, whose child record carries core's `parent` and
`die_with_parent`. A kept replacement keeps pid 100 and changes only argv, so a
pid-only confirmation diverges. Witnesses `cascadeConfirmed` and
`unconfirmedCascadeRefused` are required per seed. Two production negative controls
must be rejected through `core.state`: a refusal that compares pids only and one
that lets an unconfirmed terminal pass.

World's float shell (the room shell that replaces Herdr Float on core) adds no
model action. Its run, attach and end go through the same `CoreOperationFence`
(lease, generation and core process at dispatch and publication; the program
occupant for end, deliberately not its foreground), so it inherits this seam
and its tests. One shell per room is core's own live-name uniqueness, observed
by World rather than decided by it; the first paint waiting for the open reply
and credit returned only as a browser drains are one socket's framing and flow,
outside this model's claims, as is a view cancelled while it opens (its late
attachment is detached at once). `float-shell.test.ts` injects each fault
(`kill -9` mid-stream, EOF, a split UTF-8 character, an oversized `missed`,
exhausted credit, a replaced occupant, a foreign terminal holding the name) and
`core.live.test.ts` repeats the flow against the release.

## Observe family (issue #867)

Watching a terminal adds a third schedule family. The source is core's size
rule (`viewers.rs`): the most recently active typing viewer sets the grid, an
observer never does, and with no typing viewer the terminal is headless. Every
attach re-applies the rule, so an observer attaching alone moves an unviewed
terminal to headless; that is allowed and reported, never hidden. A confirmed
observer receives RESIZE and then a repaint for every grid change; while it has
no credit core keeps only the newest grid and repaints instead of replaying
the backlog.

| State | Meaning and boundary |
| --- | --- |
| lead, grid | The desktop pane's size (two sizes, or closed) and core's grid. Grid ids: pane sizes, headless, a size no pane set. |
| watching, confirmed, stream | One World watch, whether its attach reply confirmed resize notifications, and the stream it belongs to (a new one after unwatch, disconnect or restart). |
| frames, credit, pendingGrid, backlog | Core-to-World frames in order (`resize` then `data`, each tagged with the grid it was drawn for), World's credit, and what core holds while credit is exhausted. |
| shown, misdrawn, typed | The grid World's terminal has adopted; whether any paint was drawn on a grid other than its own; whether World ever sent input, size or focus. |

Transitions: `pane` (open, resize, close), `output`, `watch` (path confirmed or
not), `unwatch`, `stall`/`drain` (credit), `frame` (the page consumes the next
frame) and `viewport` (rotation or keyboard). `watched` joins `safety`: no paint
lands on another grid, World never types, and while watching core's grid is
the pane's, or headless when there is none, whatever World did. Witnesses:
`watchAdopted`, `observerAlone`, `headlessFollowed`, `stallReleased` and
`unconfirmedRefused`.

Production mapping: the replay builds every attach with World's
`watchAttachParams`, accepts or refuses it with `acceptWatchReply`
(`server/src/herdr-core/client.ts`), and feeds every frame through the page's
`CoreWatchScreen` (`web/src/coreWatch.ts`), whose surface records the grid each
paint is drawn on. Three production negative controls must each be rejected
through `core.state`: an attach as a typing viewer, an unconfirmed reply
accepted, and a page that draws without adopting the announced grid. Credit,
detach and the drop of an ended stream's frames are covered by the client and
relay tests (`watch.test.ts`, `watches.test.ts`), the recorded 0.1.20 replay
with a 4-byte character split across frames (`watch-replay.test.ts`), the
browser suite (`CoreTerminalWatch.browser.test.ts`, including a paint that a
following grid must not overtake) and the live release check.

## Shared seen (issue #868)

[`quint/herdr-core-seen.qnt`](../../../quint/herdr-core-seen.qnt) is a separate
bounded case for the app label contract (`herdr.seen`, plan M9): one core
agent, one World look and one other Herdr client, turns 0–2. World's browser
decides when a person looks (`refresh`): only a looking, foreground page on a
current host decides, and it decides each turn once per look. A look ends when
the peek closes or the page leaves the foreground. A decision to write carries
the label it saw; World's service writes (`dispatch`) only while its ordered
observation still holds that label, only to raise and never past core's turn.
A failed write (`lose`) is not retried. The other client looks (`appSeen`) or
marks a seen turn unread (`appUnread`, turn − 1).

Safety forbids a write over a label other than the decided one, a lowering
write, a decision over an unread made during the look, and a decision from a
hidden page or stale host. TLC explores the whole graph (3,339 distinct states).
Three seeds sample 500 traces each; every trace replays through the production
`CoreSeenSharer` (`web/src/world/coreShared.ts`) and `seenToShare`
(`server/src/herdr-core/shared-state.ts`), through `seen.decision` and
`seen.dispatch`. The browser updates on every step that can end a look, as
`useCoreSeen` does on unmount, blur and visibility change. Five model faults
(forgotten look, hidden page, stale host, blind write, unchecked write) must
violate safety and diverge, and four production faults (the first four) must be
rejected by a valid trace. Turns 0–3 add 100 sensitivity traces.

The model's label is World's ordered observation. Core has no compare-and-set
(upstream Q7): another client's change that World has not yet received, or an
unread that returns the label to the decided value between decision and
dispatch, can still be overwritten. Favourite (`herdr.pinned`) is a one-key
last-writer-wins change with no ordering rule, and push follows Herdr's
attention rule from the ordered mirror; both are checked by unit, RPC,
recorded 0.1.20 and live-release tests, not by this model.

Run `bun quint/run.ts --case herdr-core-seen` during development.

## Bounds, evidence and acceptance

The single module has three explicitly bounded schedule families. Ordering explores
two independent source deltas, created/removed terminals and recovery. Authority
interleaves one source delta with the delayed operation, profile switch and kept
replacement. This avoids multiplying irrelevant data permutations into every
operation state; it does not claim arbitrary two-delta/operation schedules.
Observe has two pane sizes plus closed, three pane changes, two outputs (none
while four frames are in flight) and two watch streams. Ordering and authority have
two terminals, independent integer x/y facts, two connection
attempts, two profiles sharing one core, one process restart, one replacement,
one captured operation and one source queue. Created/removed events and delayed
callbacks are explicit. TLC explores the reachable bounded state graph after quotienting replay-only
action/target labels and admitted/dispatched/published receipts. None of those
fields participates in a transition guard or safety invariant; all authority,
source state, cuts, pending work and safe-effect history remain. Sampling weights
favor the queued-replacement race without adding or removing any transition.
Three
seeds (42/73/103) sample 500 ordering/authority traces and 200 observe traces
of up to 25 transitions each, all replayed. The simulator samples the observe
family on its own (`OBSERVE`), because its action list changes how the
simulator weights the others. TLC explores every family, each with the actions
its simulation takes, and runs sends only in the authority family without a
child and kills only in the one with a child. The send fence (lease, occupant,
queued delivery) and the kill fence (plan, confirmation) read disjoint fields
and each still meets every source, cursor, replacement and connection change,
so this drops only their product (769,597 to 288,538 distinct states). Every
model fault below still yields a TLC counterexample in this quotient.
Each fault is checked exhaustively with TLC; a simulator search of up to
200,000 samples with seed 42 extracts its ITF replay with the same transition bound
(observe faults in the observe-only simulation);
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
upstream Q3 execution-time fence, OS/SSH/Windows named pipes, app placement (shared seen is the separate case above), browser grids, performance or
temporal recovery. P1–P6 consumer/platform checks in [delivery](delivery.md) remain
mandatory before their paths ship. Do not promote a fake into production evidence.

## Session input mapping (issue #870)

The dispatch replay additionally drives production `coreRecipientToken` and
`coreRecipientChange`; `loseForeground` refuses a captured recipient whose
current foreground is missing. Its production mutant permits absent foreground
and must diverge through `core.state`. The original source/observation authority
seam and Q3 limitation remain: this is not a proof of execution-time core fencing.
`delivery.test.ts` drives the real provider through replacement, reporting loss,
missing foreground, cancellation, timeout and a lost reply. `ask-delivery.test.ts`
drives the SQLite dispatcher and compares its delivered state with the TUI
consumer. Native send/keys bytes captured from scratch core 0.1.20 replay at
one-byte boundaries in `delivery-replay.test.ts`. Core stream ordering and credit
rules are unchanged; the existing EOF/UTF-8/oversized-missed/exhausted-credit
cases remain required. No terminal/stream throughput improvement is claimed.
