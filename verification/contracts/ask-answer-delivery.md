# Saved answer delivery consumer

Requirements: `openspec/changes/ask-answer-delivery/specs/ask-answer-delivery/spec.md`
and the declared `world.ask.deliver-answer` verb in the World effects contract.
This supplements Q29; independent mapping review and CI acceptance remain required.

Allowed: one immutable answer and reference-only opaque intent commit together;
new verified original source/terminal/session binding; pending during outages;
re-resolution after runtime replacement only on the same original binding;
claim, current authorization/version/binding checks, durable dispatching, guarded
Chat input, and an honest native receipt. CLI output can settle exact receipt
only as the verified original asker, after stdout succeeds. Owner resend/close
compare both answer occurrence and observed attempt. Withdrawal can cancel work
before submission, and never erases possible-send uncertainty.

Forbidden: copied answer text in the intent; historical import/backfill sends;
self-answering agents or downgraded owner-only policy; guessed/replacement sessions
or another connection; generic queued Chat/terminal input; automatic opaque replay;
a stale decision/receipt settling a newer attempt; interpreting a queued native
receipt as agent execution or model reading; using a synthetic receiver's dedupe
as a Herdr guarantee.

`answer-transitions.test.ts` covers the finite owner-decision matrix across pending,
claimed, dispatching, uncertain, refused, delivered and cancelled states, including
stale witnesses. Additional real SQLite cases check occurrence immutability,
claim/dispatch distinction, exact verified CLI receipt, withdrawal and read/send
races, recovery and version/current-policy refusals. `answer-migration.test.ts`
checks v1 snapshots and historical answer preservation without backfill, and
strips forged recipient/occurrence/delivery annotations from JSON imports.
Attempt history stays at eight recent rows plus the latest uncertain row; older
safe retries cannot erase evidence of a possible earlier submission.

`answer-dispatch.test.ts` checks due-time admission, backward/forward wall clocks,
60-second maximum re-arm, offline reattachment, scheme/session replacement,
current answering-actor authority, blocked input, preparation failure, explicit
resend and stop/drain. The overfull open-backlog case protects the new answer
and its intent in the same retention mutation. `answer-service.test.ts` uses a
real loopback child process to verify Linux caller identity and production
producer/ACK hooks; it checks the separate notice channel and exact owner API.
The Linux-specific caller test does not establish verification on other platforms.

`answer-delivery-crash.test.ts` kills real source and standalone compiled
processes before claim, after claim, before a native effect, after a native effect,
and after its receipt. It uses the production Chat source, temporary SQLite
worker and a synthetic external receiver that records every prompt without
deduplicating. A pre-send claim can resume safely; a possible send remains
uncertain and does not replay. Native CI repeats these schedules and the schema
transition tests. These are finite process-fault schedules, not power-loss or
all-schedule proofs.

CLI tests check successful output before ACK, broken pipes, lost acknowledgements
and other readers. Actual Chat race tests retain current session/lease fencing
and its queued-session receipt. Browser store tests retire old service replies;
component and five-viewport Chrome tests check reachable answered notices with
zero open questions, bounded pages and explicit duplicate confirmation/cancel.
Whole-outbox aggregates keep older actionable items reachable beyond the first
page. The compact row counts only unconfirmed/not-sent work; waiting-only sends
appear in Summary and a per-host letter tag. Keyboard cases cover section focus,
confirmation/cancel, stale confirmation withdrawal, post-dismiss focus and polite
status. A temporary Sent card requires an exact positive receipt read; its
bounded memory never supplies delivery authority. Open agent only navigates the
fresh original terminal explicitly and never changes the stored recipient.
The full affected browser and behavioral gates remain independent requirements.

Maintained runtime-lease and creation-flow models retain their existing accepted
scope. They do not model SQLite commits, CLI stdout or Chat's filesystem-backed
session projection. The direct SQLite transition matrix, actual worker/process
fault schedules and real Chat/CLI/browser consumers are the selected alternative
here; adding an abstract model would not establish those platform boundaries.
No new or expanded Quint claim is made.
