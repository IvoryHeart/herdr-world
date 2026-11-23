# Durable asks and attention recovery

Requirements: `openspec/specs/world-storage/spec.md`. This supplements the Q29
notification assessment with a candidate, without expanding accepted Quint or
consumer claims. Independent review and the complete applicable delivery gate remain required.

Allowed: atomic domain/declared-outbox commits; post-COMMIT acknowledgement;
one worker owns the database; explicit uncertainty after interrupted dispatch;
safe user-alert retries with bounded backoff; cancelled alerts when asks close;
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
The snapshot VACUUM destination must be absent inside a private directory,
including on native macOS SQLite; publication must preserve prior snapshots.
The compiled crash entry is outside storage/ and uses the release minify and
source-map flags, preserving the production worker's embedded path. The large
real-FULL-sync history fixture has an explicit watchdog, not a latency claim.
`world-storage.test.ts` must cover exclusive ownership, isolated roots, reopen,
an abandoned open that closes its database before it rejects,
hash-named private import backup, a changed source never re-imported after
the import marker (#1253), malformed legacy input and recovered uncertainty. `world-worker.test.ts` keeps the
service composition out of the worker's import graph, which each open re-parses.

The storage, Board, profile, runtime-status, terminal-mark and answer-delivery
crash consumers share `storage/testing/crash-harness.ts`. It separates compilation,
seed initialization and ordered fault-child setup from their existing 5/30/60-second
recovery budgets. Answer delivery retains its later 30-second recovery subprocess
and current-run authority/class assertions. The shared helper preserves marker and
clean-exit checks, bounds kill/reap/stream cleanup, and emits failure-only
compile/spawn/marker/kill/reopen timings. `storage/testing/crash-harness.test.ts`
checks these lifecycle boundaries and exceptional cleanup with controlled time
and process doubles; these controls do not establish SQLite or native-platform
recovery. Every real crash suite remains required and the native installer storage
command includes profiles alongside the other five suites. No recovery, identity,
external-effect or latency claim is expanded by this test-lifecycle refactor.

`attention-dispatch.test.ts` must check claim commit before Herdr, final versus
temporary refusals, bounded backoff, closed-ask cancellation, lease retirement,
notification rebinding only on the original connection and own-ask response
isolation. CLI `world.test.ts` must preserve fallback when recording fails and
report the service's actual alert outcome and retry status when recording
succeeds. Integrated root tests must fail when dispatch outlives storage or a
worker fault leaves a service running with a dead ledger. Failure-driven close
must be observed before assertions; calling explicit stop cannot supply that
evidence. Own-ask isolation uses a deferred unrelated send, without an elapsed-
time assertion.

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
isolation, a latency SLA and downstream execution/read exactly once. The separate
[answer delivery contract](ask-answer-delivery.md) maps the implemented opaque
answer verb and its real Chat, CLI-receipt and user-recovery consumers. It
requires its own independent acceptance. Prior draft passes do not establish
the reviewed repairs.

`world-identifiers.test.ts` checks store collision rejection and eight-symbol
base32 IDs without clocks/counters. `service/storage-lifecycle.test.ts` checks
independent roots, actual worker-loss signaling and root fail-stop. The root's
`world-service.test.ts` retains its public HTTP/WebSocket two-root isolation
checks and inspects the persisted SQLite family after close. Reception unit
coverage retains question counts, shows failure/uncertainty and consumes a newer
query revision for delivery-only evidence. Ordinary successful markup stays
unchanged. Native/platform and independent review acceptance remain separate.


## Legacy folder (#1253)

Imported legacy JSON, its backups and schema snapshots beyond the newest three
move to `<data>/legacy/` inside the worker's exclusive open, after every import
commits. One writer holds the folder, so no second mover races it. A move has
three states: not linked, linked under both names, old name removed. A crash in
the linked state is finished on the next open without another copy; the other
two are idempotent. A source already inside `legacy/` is its own target and
stays put. Discovery and move failures are logged and never block the open.
`legacy-archive.test.ts` covers the linked state, a pre-SQLite folder reopened
with identical Board, profile and ask state, older importers skipping the moved
files, a ledger configured inside `legacy/`, an unreadable retired import path,
and snapshot placement by write time rather than schema version. These finite cases exhaust
the move's states, so no Quint model is added. Nothing is deleted; physical
power loss between link and unlink stays excluded as above.

## Question ownership and cap admission (#1128)

Question closure belongs to the verified immutable connection plus stable
terminal, not to the current occupant fingerprint. A freshly verified caller
may close its terminal's old questions after generation/session replacement;
another terminal, another connection or an unverified claim must fail. Closure
changes only World-owned records. It grants no downstream operational lease,
answer delivery or original-recipient acknowledgement authority. Cause-key
creation deduplication remains occupant-scoped; withdrawal by key recovers the
newest retained question for that cause on the verified terminal. Legacy
records missing stable terminal identity retain their previous strict guard.

State-model assessment: identity and ordering both matter. The existing Quint
runtime-lease and binding models fence downstream sends; weakening those models
to permit generation-independent runtime authority would be wrong. No new
independent external effect is introduced here. All question-state changes
linearize in the serialized ledger callback against current rows, so a finite
exhaustive implementation sweep is the selected cheaper alternative to another
Quint model. `world-question-ownership.test.ts` exercises all 128 combinations
of verification, connection, terminal, pane, generation, session and fingerprint
agreement for ID and key withdrawal (256 cases), plus all 120 permutations of
restart, withdrawal, answer, owner bulk dismissal and cap admission. It compares
every intermediate record with an independent open/closed-state oracle, checks
rejected cross-terminal/process claims through real core caller resolution,
and preserves other askers and saved answers.

`question-backlog-storage.test.ts` retains the actual SQLite writer boundary:
two asks suspended after the initial allowance check compete for one remaining
slot, only one commits an attention intent, repeated cap refusals add no effects,
and closure allows fresh admission. Reopen plus owner RPC checks one revision
for an entire cross-generation backlog, pending-alert cancellation and other
terminal isolation. `cli/world.test.ts` checks repeated cap errors never invoke
Herdr fallback while unexpected failures still do; `http/world-cli-endpoint.test.ts`
checks HTTP 429. `NeedsYouAskerActions.dom.test.ts` exercises the production
control and store with a cross-generation 31-question backlog, isolation by
terminal despite equal names, save failure and retry. The same synthetic fixture
is available through `?questionBacklogFixture`, consumed before normal routing.

These finite checks exhaust the serial orders and identity equality classes
named above, not arbitrary external runtime replacement or process/filesystem
failures. Existing current-generation, process-verification, SQLite crash and
original-recipient answer suites remain required. Run the full verification
gate and retain independent PR review; no prior model acceptance is extended.
