# Delivering saved ask answers

A new `herdr-world ask` from a verified local Linux caller can receive its saved
answer in the original supported Chat session even without `--wait`. The binding
is captured when the ask is created; legacy and unverified records are never
backfilled. `herdr-world ask get ID` remains the retrieval path on every platform.

Recording an answer commits its immutable occurrence and one reference-only
`world.ask.deliver-answer` intent together. The dispatcher waits three seconds,
then uses Chat's existing guarded input path. An offline original host stays
pending; a changed or ended session records not sent. A definite refusal before
input may wait and retry. Once a send might have happened, recovery is opaque:
uncertain remains visible and is never automatically repeated.

Town Summary’s **Outbox** keeps recovery reachable without
reopening the question or inflating Needs you. Reception has one compact Outbox
row for unconfirmed/not-sent answers to check; waiting-only deliveries stay in
Summary and the original host's `✉N` letter tag. Full cards live in Summary.
An exact status read can show a temporary **Sent** receipt after resend, or
**Received by CLI** for that distinct proof, without implying agent reading.
**Send again…** requires explicit
possible-duplicate confirmation and always rechecks the original recipient.
**Dismiss** or **Cancel send** stops delivery while preserving the answer. Neither action
can change an active send or apply to a stale answer/attempt.

The verified original asker acknowledges the exact observed answer and attempt
only after successful stdout output. Broken pipes send no acknowledgement. Lost
acknowledgements and read/send races can duplicate output. Chat's native receipt
proves queuing to its reported session, not execution or model reading. Current
Herdr has no operation key or atomic expected-session prompt; no downstream
deduplication is assumed. Dismissals send no pane text. Ordinary Chat and terminal
sends remain direct and nonqueueable.

See the [deployment and backup guidance](DEPLOYMENT.md#durable-questions-results-and-backups),
[change design](../openspec/changes/ask-answer-delivery/design.md), and
[verification contract](../verification/contracts/ask-answer-delivery.md).
