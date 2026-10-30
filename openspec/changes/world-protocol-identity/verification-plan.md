# Verification plan: World protocol and identity

This plan follows `verification/README.md` and the contract template.
- **Properties come first.** Each property is derived from the requirements in this
  change and their allowed and forbidden scenarios, before any implementation is mapped.
- **Models land with their code.** A model ships in the PR that implements its
  behaviour, with replay adapters that drive the real code, required witnesses on
  production replay, and negative controls.
- **Mapping goes with the stage.** Each implementing PR updates
  `verification/coverage.json`, the affected contracts and the mandatory consumer tests,
  and runs the complete `verification:gate`. Focused `--case` runs do not replace it.

This PR changes no current contract, model, adapter or coverage entry. It only fixes
what each later stage must add or re-map.

## Models

Every model uses the maintained settings:
- seeds 42, 73 and 103;
- 500 samples and at most 25 transitions per seed;
- TLC over the finite domain;
- a `BROKEN` model fault whose counterexample must fail a named replay observation;
- at least one compiled code fault per property.

No model claims temporal liveness.

### M1. `observation-base` (new, stage 3, Q14)

Observation v1's base admission. It sits beside `browser-refresh` and
`browser-preparation`, which keep their accepted scope: one request in flight,
observation epochs and staged per-host retirement.

- **State.**
  - **Service:** incarnation; for each of two hosts, a generation and a token.
  - **Browser:** held incarnation, observation epoch, and for each host its admitted
    generation, token and qualified liveness.
  - **Request:** its captured base and the epoch it was issued in.
- **Actions.**
  - `change(h)`: a new token;
  - `retire(h)`: a new generation, observed by the service;
  - `browserRetire(h)`: client-side qualification only;
  - `restart`: a new incarnation; generations restart at 1;
  - `request`: captures the base;
  - `reply`: the service rule is applied to the captured base;
  - `apply`;
  - `disconnect`.
- **Invariants.**
  - `replyEqualsFresh`: after `apply`, every admitted host's generation and token equal
    the service's at reply time.
  - `noResurrection`: an actionable host is live under the browser's qualification and
    has its current generation.
  - `incarnationReset`: no admitted host carries content from another incarnation than
    the last admitted reply's.
  - `confirmationHeld`: a confirmation is applied only while the browser holds the base
    entry it sent; otherwise the reply is discarded.
- **Witnesses:** `unchangedSkip`, `oneHostReplaced`, `incarnationChanged`,
  `retiredDuringRequest`, `discardedConfirmation`.
- **Controls.**
  - Model: `BROKEN` confirms by token alone, without the generation.
  - Code: the generation check is removed, which must fail `base.generation`.
  - Code: the incarnation reset is skipped, which must fail `base.incarnation`.
- **Adapter.**
  - The service rule runs as a direct exhaustive check over the finite domain, through
    the real snapshot service's reply builder.
  - Browser application replays through the real runtime store, with controlled
    replies and the real Bridge lease gate, as `browser-preparation` does.
- **Domain:** 2 hosts, generations 1–2, tokens 0–2, incarnations 0–1, at most 6
  requests.

### M2. `subscription-resume` (new, stage 7, successor to `browser-refresh` for v2)

- **State.**
  - **Service:** incarnation, World sequence, retained horizon, and per-key versions
    for two keys.
  - **Subscription:** generation, watch installed, watermark, page cursor, buffered
    changes.
  - **Client:** subscription generation, cursor, per-key applied versions, bootstrap
    stage.
- **Actions.** `subscribe(since?)`, `page`, `ready`, `change(k)`, `deliver` (a batch,
  optionally composed), `disconnect`, `resume`, `evict` (the horizon advances),
  `restart`, `overflow` (a slow consumer is reset).
- **Invariants.**
  - `deltaEqualsState`: once the client is ready at cursor S, its per-key versions
    equal the service's state at S.
  - `noGap`: a client never advances past a change it has not applied, except through
    a reset and bootstrap.
  - `noStaleGeneration`: no delivery from an older subscription generation or
    incarnation is applied.
  - `resetOnUnknown`: a resume below the horizon or from another incarnation yields a
    reset, never a partial stream.
- **Witnesses:** `resumeContinues`, `resumeBelowHorizon`, `restartReset`,
  `changeDuringBootstrap`, `slowConsumerReset`.
- **Controls.**
  - Model: `BROKEN` installs the watch after the watermark. That loses a change and
    must fail `deltaEqualsState`.
  - Code: resume accepts a foreign incarnation, which must fail `resume.incarnation`.
- **Domain:** 2 keys, at most 4 changes, horizon 2, incarnations 0–1, subscription
  generations 0–2.

### M3. Paged bootstrap credits (stage 7, Q12, re-mapped)

v2 pages reuse the socket-local admission class with request identity
`(subscription, subscription generation)` and page numbers as batch indices. In that
case `chunk-credits.qnt` and its properties carry over unchanged:
- capacity two per socket;
- only the expected page releases a credit;
- a foreign socket or request cannot release a credit;
- retirement rejects pending waits.

The adapter is re-mapped, and a reset during a bootstrap becomes the existing
close/retire transition. Q13's `chunk-assembly` maps to page assembly in the same way:
pages hold whole rows, and batches from mixed generations cannot assemble. If the
implementation does not reuse the admission class, M3 becomes a new model with the same
properties, decided in that PR.

### M4. `binding-resolution` (new, with `world.sqlite` bindings and per-terminal settings)

- **State:** one binding (kind, native ID, witness, state), one source entity (native
  ID, terminal, present), source health (current, partial, offline), the runtime
  generation, and any user decision.
- **Actions:**
  - `observeComplete` and `observePartial`;
  - `offline`;
  - `herdrRestart`: same IDs, new terminals;
  - `worldRestart`: bindings kept, observation reset;
  - `moveByWorld`: previous and new IDs for the same terminal;
  - `closeObserved`;
  - `notFound`;
  - `userKeep` and `userDetach`;
  - `lookAlike`: the same label and cwd, a new terminal.
- **Invariants.**
  - `noUnverifiedRetarget`: the target changes only through `moveByWorld` with the
    witnessed terminal, or through a user action.
  - `absenceOnlyAuthoritative`: `ended` follows only a complete listing, not-found or an
    observed close on the current generation that names the bound target.
  - `reuseNeverAttaches`: a reused ID without the witnessed terminal is never
    attached.
  - `unresolvedPreserves`: offline and partial observations leave the saved binding
    unchanged.
  - `onlyAttachedActs`.
- **Witnesses:** `restartUnconfirmed`, `worldRestartReattached`, `partialKept`,
  `closeEnded`, `moveFollowed`, `lookAlikeRejected`.
- **Controls.**
  - Model: `BROKEN` attaches by label.
  - Code: the witness comparison is removed, which must fail `binding.attached`.
- **Adapter:** the real binding resolver, fed synthetic observations. The Board string
  witness tests and the per-terminal settings tests become its mandatory consumers.

### M5. `effect-recovery` (new, with the substrate, committee item 15)

- **State.** For each of two intents:
  - its status;
  - its recovery class (keyed, reconcilable, reattachable or opaque);
  - its attempt fence (incarnation, number);
  - whether it was dispatched;
  - whether the effect happened;
  - its receipt;
  - authorization;
  - cancellation;
  - its supported version.
- **Actions.**
  - claim and dispatch;
  - `crashBeforeClaimCommit`, `crashAfterClaim`, `crashAfterDispatch`;
  - restart and recover;
  - reconcile and reattach;
  - cancel and revoke;
  - `ownerDecide`;
  - `upgradeWithoutVersion` and `migrate`;
  - `signalEarly` and `signalDuplicate`.
- **Invariants.**
  - `singleActiveAttempt`.
  - `noDispatchAfterCancelOrRevoke`.
  - `noBlindRetry`: an opaque intent that may have dispatched is never dispatched again
    without `ownerDecide`.
  - `reattachNotRelaunch`.
  - `migrationNoDispatch`.
  - `completedNeverReplayed`.
  - `signalOnce`: one stored signal per dedupe key, kept until resolved.
- **Witnesses:** one per row of the recovery matrix in `design.md` §12, plus
  `earlyAnswerKept`, `duplicateSignalIgnored` and `deadlineAfterRestart`.
- **Controls.**
  - Model: `BROKEN` retries opaque intents after a crash.
  - Code: the authorization recheck is skipped, which must fail `effect.authorized`.
  - Code: the idempotency key is dropped on retry, which must fail `effect.receipt`.
- **Adapter.** The real outbox runs on a temporary `world.sqlite`, closed and reopened
  at named crash points. A scripted adapter implements each recovery class. This is
  committee test stage T4.

## Property and direct suites (alternative evidence)

| Suite | What it proves | Why not a model |
|---|---|---|
| P1 Composition laws | For seeded random change sequences: applying composed batches equals applying every change; delete ends a lifetime; delete-then-recreate stays two lifetimes; durable records are never composed | algebraic laws over arbitrary values; seeded property tests explore them better than a finite model |
| P2 Replacement and delta equivalence | v1: base replies applied to a held state equal a fresh complete reply. v2 shadow: keyed diff applied equals the fresh projection, on the dense fixture and on seeded topologies (including one room with 1,440 desks) | data-shape coverage at scale; the 8788 shadow run supplies the gate's working-day evidence |
| P3 Adapter conformance | the shared suite against Herdr (synthetic fixtures plus one disposable `herdr --session`) and against the synthetic source | behaviour of external sources, fixture-driven |
| P4 Verb policy table | for every registered verb × actor, the policy equals the reviewed table; every browser-called method is registered; unregistered methods are refused before dispatch | finite and exhaustive; enumerated directly |
| P5 Per-terminal settings | against a disposable `herdr --session`: token write and read, terminal witness, move, Herdr restart (tokens gone), the 32-key limit refused and shown, Town master revision and tie | platform behaviour of Herdr itself |
| P6 Work counts | v1 incremental preparation: all-unchanged replies rebuild and publish nothing; one status change prepares one room; consumed-view preparation; equivalence with complete preparation | deterministic counters (committee T0 and T3) |

## Coverage re-mapping

The owner approves the stage 7 re-mapping, as committee stage 7 requires. Stage 3
changes are additive.

| Area | Today | Stage 3 (v1) | Stage 7 (v2) |
|---|---|---|---|
| Q12 Snapshot chunk credits | `chunk-credits` | unchanged: large v1 replies still chunk | re-mapped to paged bootstrap credits (M3) |
| Q13 Chunk assembly | `chunk-assembly` | unchanged | re-mapped to page assembly; the decode worker stays until its replacement closes the same claims |
| Q14 Browser aggregate refresh | `browser-refresh`, `browser-preparation` | adds M1 `observation-base` and P6 | `subscription-resume` (M2) for v2 consumers; the v1 models remain while v1 is served |
| Q07 Terminal input and reconnect | `chunk-assembly`, `creation-flow` | unchanged | page assembly plus `creation-flow`; terminal bytes keep their direct tests |
| Q15 Focused operational contexts | `creation-flow`, `browser-preparation` | adds a regression: reused host objects keep each context's captured owner | M2 for topology; creation unchanged |
| Q16 Resource caches | `browser-preparation`, `runtime-leases` | unchanged | M2: cache invalidation keyed by qualified row keys |
| Q18 Watchlists | `runtime-leases`, `browser-refresh` | unchanged | M2: the watchlist becomes a replaceable query; a service restart is an incarnation reset |
| Q20 Shared entity identity | `browser-preparation`, `space-admission` | adds a regression: identity reuse never aliases hosts or generations | M2 keys plus `space-admission` |
| Q32 File search and drafts | `browser-preparation`, `runtime-leases` | unchanged | M2 |
| Q04 Herdr subscriptions | `runtime-leases`, `runtime-drain` | adds direct tests per event class for the repair rules (dirty read, lost events, re-list) | unchanged |
| Q10, Q11 Aggregate observation and scheduling | direct scheduler tests | adds direct tests: token stability and the confirmation rule | adds the drift-check tests and the P2 shadow |
| Q24 Desk receipts and marks | direct tests | unchanged | unchanged, unless the owner approves durable marks |

**New areas**, added by the PR that implements each one:

| New area | Owner | Evidence |
|---|---|---|
| Service incarnation and fences | connection manager, hello, persisted captures | direct tests: a restart at generation 1; tokens crossing a restart (Q14 consumers) |
| Durable identity and bindings | identity module | M4 |
| Effects, outbox and inbox | effects module | M5 |
| Adapter conformance and the synthetic source | adapter registry | P3 |
| Verb registry and actor policy | RPC dispatch, CLI, sources | P4 |
| Per-terminal settings | profile service, Herdr metadata writers | P5 plus M4 consumers |

## Cost

The canonical gate runs 11 models in about 141 seconds locally with two workers. M1, M2,
M4 and M5 are sized like the existing models. Each PR records its added time and must
stay inside the 15-minute deadline and the 4 GiB cgroup envelope.
