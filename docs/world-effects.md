# Durable World effects

World's existing `world.sqlite` outbox owns durable effects. Recording the domain
change and its intent is one SQLite transaction. The service registry marks only
three private effect verbs queueable: `notification.show` for owner alerts,
`world.ask.deliver-answer` for one saved answer and its original recipient, and
`world.bin.close` for one pane whose agent-bin countdown ended.
Interactive terminal input and Chat sends stay nonqueueable. This substrate
provides no workflow authoring API or new browser controls. Its schema migration
follows the durable ID, binding, profile and runtime-status migrations, preserving
all existing families and reservations.

An intent stores validated reference parameters, its captured targets, actor and
authorization evidence, stable idempotency key, operation version, preconditions
and creator origin. Saved-answer intents copy no question or answer text. The
driver reads the committed ask when dispatching and uses Chat's existing guarded
send path. Alerts capture only the original connection. Resource targets capture
adapter, connection, kind, native ID and terminal/session evidence; a creation
generation is never a durable target.

A runner drains one verb serially. A dispatcher may instead run one lane per
connection (the runner's `connection` option): each lane's query selects its
connection before the 100-row bound, and lanes are found from storage
(`EffectStore.lanes`), so one host's backlog never hides or delays another
host's work. Without the option the runner behaves as before.

Herdr dispatch authority is limited to the World run that captured it. New alert
contracts record that run in `authorization.service_incarnation`; saved answers
use their original recipient's `service_incarnation`, and bin closes the run that
recorded them. This is World-run authority,
not native runtime continuity proof. Herdr protocol 22 has no checkable boot token;
matching connection, numeric generation, pane, terminal or session labels after
World restarts cannot establish continuity. Old or missing authority refuses a
provably unsent alert/answer; any possible send stays uncertain. Legacy migration
never grants a new run's authority. Saved answers remain available through
`herdr-world ask get ID`, and completed receipts/history remain intact. Even an
explicit possible-duplicate decision cannot bypass this eligibility check.

Each attempt is claimed with the current service incarnation and a monotonically
increasing attempt number. Only one claim succeeds. Before external submission,
the runner resolves fresh qualified targets and checks current authorization,
preconditions and version support, then commits `dispatching`. The synchronous
native guard checks the live lease and authority again. Receipts can finish after
cancellation or revocation because they describe an effect that already happened.

| Recovery class | After a possible effect without a receipt |
| --- | --- |
| `keyed` | Retry with the original key and record the source receipt |
| `reconcilable` | Read decisively; record an existing effect or retry only after confirmed absence |
| `reattachable` | Find or use the retained external handle and observe that run; never relaunch |
| `repeatable` | Retry; harmless duplicates are allowed |
| `opaque` | Remain uncertain until an authorized explicit decision |

Production currently uses repeatable alerts, opaque saved answers and the
reconcilable `world.bin.close` ([bin close](../server/src/world/bin-close.ts)): its
decisive reconciliation reads the captured pane's workspace on the captured
runtime generation, and it records nothing as sent once that generation is
replaced. Their same-run retries retain these classes; restart does not grant
permission to send to a replacement Herdr. Synthetic keyed, reconcilable and
reattachable sources exercise the kernel in tests and verification; they are
absent from the production registry. A future source must
implement its own decisive reconciliation or existing-run observation, including
current target fences, before registering that recovery class. Recovery reads
observe the original effect; they do not grant authority for a new submission or
cleanup. There is no exactly-once execution claim.

Claims interrupted before `dispatching` are released on restart, then subject to
the driver's continuity/World-run eligibility. Offline bindings within a run
wait without age expiry and are checked again when available. Ended or unconfirmed
bindings are not sent only if no attempt ever reached `dispatching`; later loss
preserves uncertainty. Cancellation before dispatch releases the claim. After
possible dispatch, cancellation prevents another submission and preserves actual
receipts or uncertainty. Permanent refusals keep their reasons and stop automatic
attempts. Closing an ask stops its alerts; an earlier possible alert remains
recorded without claiming it was undone.

An explicit owner decision may retry an eligible uncertain intent or close its tracking.
Closing preserves the actual attempt outcome, receipt, handle and possible-send
evidence; it does not report that an earlier effect was undone. The internal close
decision allows normal history retention only after that explicit resolution.

Operation contracts are pinned. An unsupported pending version is projected as
`needs-migration` and excluded from runnable queries. Migration is an explicit
owner transition with a recorded reason and old/new versions. It preserves the
intent identity, key, receipts and external handle. Completed effects stay
completed. No new public migration endpoint is exposed by this change.

Deadlines persist wall time. The injected `Clock` and `Scheduler` recheck it on
every wake and rearm no more than 60 seconds ahead. Early or backwards-clock
wakes cannot send early; overdue startup and sleep wakes recheck authority before
sending. Core effects/storage and dispatch modules reject direct wall-clock and
timer globals in lint. Test fixtures and system ports own real time.

The server read contract is `createWorldEffectQueries`:

- `ask(id)` returns the committed ask, including existing delivery evidence.
- `notices(kind, after?, limit?)` returns existing bounded notice pages and counts.
- `intent(id)` returns the canonical pinned contract, attempt fence, state,
  current outcome, handle and explicit decisions.
- `receipt(id)` returns the intent/operation identity, version, state, receipt,
  handle, attempt and uncertainty/not-sent evidence; a pending result is not a
  successful receipt.

These are internal read contracts for review before subscriptions v2; they add no
wire API or authoring model. Existing CLI retrieval, owner duplicate decisions and
Reception presentation remain as documented in [saved answers](ask-answer-delivery.md).
Backups and migration snapshots follow [deployment guidance](DEPLOYMENT.md#durable-questions-results-and-backups).

The [M5 contract](../verification/contracts/effect-recovery.md) identifies bounded
model/replay evidence and the required real SQLite source/compiled crash matrix.

## Agent bin service

The agent bin stages closes in memory and records a durable close only when the
staging ends. Its browser RPCs (all bridge-scoped `world.*`, browser actor only):

| Method | Effect |
| --- | --- |
| `world.bin.list` | The run's state: `epoch` (the service incarnation), revision, paused, entries with time left, closing IDs, recent outcomes, `countdown_s` |
| `world.bin.add` | Stage one pane, qualified by connection, runtime generation, workspace, tab, pane and terminal; the handler re-reads the pane on that connection's current runtime first |
| `world.bin.pause`, `world.bin.resume` | Stop or restart every countdown |
| `world.bin.restore` | Take one entry back out; nothing is closed |
| `world.bin.close_now` | `ids`: an explicit list of this run's entry IDs (`bin-<incarnation>-<n>`). Any other run's ID refuses the whole request; there is no unscoped "all" |
| `world.bin.countdown.set` | 10, 30 (default), 60 or 120 seconds, kept as `bin_countdown_s` in World's settings file |

Staging lives only in the service's memory, on its monotonic clock: a reload
keeps it, and a World restart drops it without closing anything. When a countdown
ends, or on Close now, one `world.bin.close` intent per entry is recorded with the
captured target and the recording run's incarnation. A runtime generation is a
per-run counter, so the close is sent only in the run that recorded it: in a later
run an unsent close ends not sent and a possibly sent one stays uncertain; neither
is read from or sent to the host's current runtime. Within the run, the final read
before sending decides `pane.close` or `workspace.close` and must match the planned
layout. A write storage refused before sending is reported as not recorded; a
write whose acknowledgement was lost, or whose lookup failed, stays tracked by its
entry ID until a read settles it.

