# Saved answer delivery consumer

Requirements: `openspec/specs/ask-answer-delivery/spec.md`
and the declared `world.ask.deliver-answer` verb in the World effects contract.
This supplements Q29; independent mapping review and CI acceptance remain required.

Allowed: one immutable answer and reference-only opaque intent commit together;
new verified original source/terminal/session binding; pending during outages;
same-run re-resolution only on the same original binding; after a World restart,
re-resolution only with the continuity proof below;
claim, current authorization/version/binding checks, durable dispatching, guarded
Chat input, and an honest native receipt. CLI output can settle exact receipt
only as the verified original asker, after stdout succeeds. Owner resend/close
compare both answer occurrence and observed attempt. Withdrawal can cancel work
before submission, and never erases possible-send uncertainty.

Forbidden: copied answer text in the intent; historical import/backfill sends;
self-answering agents or downgraded user-only policy; guessed/replacement sessions
or another connection; generic queued Chat/terminal input; automatic opaque replay;
a stale decision/receipt settling a newer attempt; interpreting a queued native
receipt as agent execution or model reading; using a synthetic receiver's dedupe
as a Herdr guarantee.
World restart with old/missing recipient authority forbids submission unless
continuity is proved at each resolve (#1451). Herdr TUI needs the same connection,
pane and terminal and the same harness-reported session before and after the
foreground check, plus the captured conversation scheme and session fingerprint.
herdr-core needs the same core and the same terminal process, foreground leader
PID and name; native IDs or session labels alone are not proof, and legacy core
tokens stay refused. An owner duplicate decision cannot bypass this rule. Unsent
work without proof resolves not-sent, possible sends remain uncertain, and manual
close retains the actual history.

`answer-transitions.test.ts` covers the finite user-decision matrix across pending,
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
deduplicating. A pre-send claim is released and then refused without current-run
authority; a possible send remains uncertain and does not replay. Same-run actual
Chat consumers retain normal sending. `world/effect-restart.test.ts` adds distinct
actual managers with recycled generations and native/session values across every
pre-restart phase: the proven same session delivers once, a replaced session
types nothing, and explicit retry reaches only the proven session, with
receipt/history controls. `answer-foreground.test.ts` and `herdr-core/ask-caller.test.ts`
repeat the same/different matrix on TUI and core. Native CI repeats these schedules and the schema
transition tests. These are finite process-fault schedules, not power-loss or
all-schedule proofs.

CLI tests check successful output before ACK, broken pipes, lost acknowledgements
and other readers. Actual Chat race tests retain current session/lease fencing
and its queued-session receipt. Browser store tests retire old service replies;
the maintained `TownCanvas.browser.tsx` Summary consumer checks section order
and question counts with both an empty and populated Outbox. Its complete
baseline, extended, portrait, fold and navigation browser suites retain their
other layout, reception and navigation assertions. Component and five-viewport
Chrome tests check reachable answered notices with
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

Core asks use the same durable runner through native `terminal.send`, with a
verified local Linux process-ancestry capture and the program/foreground token.
`server/src/herdr-core/ask-delivery.test.ts` checks TUI/core delivered-state
parity, replaced recipients retaining the answer without input, unverified claims
and lost-core uncertainty without replay. Core recipients additionally refuse
old runtime generations; reconnect does not establish continuity. The Q52 model
checks the production pre-dispatch recipient comparison, while execution-time
queued replacement remains an explicit upstream Q3 assumption. These additions
do not expand the accepted SQLite or native-runtime continuity claims above.
