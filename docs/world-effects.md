# Durable World effects

World's existing `world.sqlite` outbox owns durable effects. Recording the domain
change and its intent is one SQLite transaction. The service registry marks only
two private effect verbs queueable: `notification.show` for owner alerts and
`world.ask.deliver-answer` for one saved answer and its original recipient.
Interactive terminal input and Chat sends stay nonqueueable. This substrate
provides no workflow authoring API or new browser controls. Its schema migration
follows the permanent World ID registry and preserves existing reservations.

An intent stores validated reference parameters, its captured targets, actor and
authorization evidence, stable idempotency key, operation version, preconditions
and creator origin. Saved-answer intents copy no question or answer text. The
driver reads the committed ask when dispatching and uses Chat's existing guarded
send path. Alerts capture only the original connection. Resource targets capture
adapter, connection, kind, native ID and terminal/session evidence; a creation
generation is never a durable target.

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

Production currently uses repeatable alerts and opaque saved answers. Synthetic
keyed, reconcilable and reattachable sources exercise the kernel in tests and
verification; they are absent from the production registry. A future source must
implement its own decisive reconciliation or existing-run observation, including
current target fences, before registering that recovery class. Recovery reads
observe the original effect; they do not grant authority for a new submission or
cleanup. There is no exactly-once execution claim.

Claims interrupted before `dispatching` are released on restart. Offline bindings
wait without age expiry and are checked again when available. Ended or unconfirmed
bindings are not sent only if no attempt ever reached `dispatching`; later loss
preserves uncertainty. Cancellation before dispatch releases the claim. After
possible dispatch, cancellation prevents another submission and preserves actual
receipts or uncertainty. Permanent refusals keep their reasons and stop automatic
attempts. Closing an ask stops its alerts; an earlier possible alert remains
recorded without claiming it was undone.

An explicit owner decision may retry an uncertain intent or close its tracking.
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
