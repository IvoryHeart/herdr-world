## Context

See proposal.md for motivation. This follows the SQLite foundation; it is not
implemented in PR 1. Architect-protocol confirmed the five verb/state/authority/
recovery/dispatch conditions under #549, with wording to be made explicit there.


- [Ask identity](../../../server/src/world/world-cli-actor.ts) verifies the caller's process
  on supported local hosts and captures the reported asking session.
  [Ask fingerprinting](../../../server/src/world/world-cli-asks.ts) hashes
  `[source, agent, kind, value]`. A claimed pane alone is not a verified asker.
- [Chat's conversation source](../../../server/src/agent/herdr-conversation.ts) already
  checks conversation identity, unsettled deliveries, command-like input and
  the current agent before `agent.prompt`. It records outcome evidence and
  detects a session change during the send. Reuse this path; add no second
  agent-input queue and never fall back to `pane.send_input`.
- [Conversation bindings](../../../server/src/agent/conversation-binding.ts) distinguish
  reported sessions, Codex title bindings and guesses. Codex's title fingerprint
  is a different scheme from the raw reported-session hash. Never pass one
  scheme to a comparison expecting the other, or learn a new recipient from a
  later title, display name, directory or reused pane ID.
- [The send-race tests](../../../server/src/agent/conversation-send-race.test.ts)
  demonstrate that Herdr cannot atomically enforce the expected session when it
  queues a prompt. Last-moment checks and later evidence cannot eliminate that
  race. PR 2 must retain this limitation and classify ambiguous delivery honestly.

## Goals / Non-Goals

Goals: one answer reaches its verified original asker without `--wait`; retrieval
remains reliable; source identity, actor authority and opaque-effect recovery
stay explicit. Existing Chat admission remains the only agent-input path.

Non-goals: backfilling old answered asks, a second send queue, arbitrary Chat or
terminal scheduling, dismissal prompts, transcript persistence, a second runtime,
exactly-once execution, or a workflow authoring model.

## Decisions

### Capture and eligibility

For newly created asks, PR 2 captures a versioned answer-recipient binding at
ask creation, in the same transaction as the ask. It includes the immutable
connection ID, the original source-qualified session identity/fingerprint and
its scheme, the current native terminal/pane witnesses, service incarnation and
runtime generation as attempt fences/evidence, with explicit inline
`{adapter, connection_id, kind, native_id, evidence}` target fields, and the conversation-source fingerprint
needed by Chat. It stores no extra transcript, credential or arbitrary path.

Capture requires a verified asker, a nonempty reported-session fingerprint and
a consistent current conversation binding. If obtaining that binding waits,
revalidate the asking occupant afterward. Fingerprints from two different
schemes cannot be equated just because their strings look alike.

An ask still records and alerts normally when eligibility cannot be established.
Its answer remains available through `ask get`. On answer, an ineligible ask
gets a final `refused` delivery result with the reason, rather than an intent
that waits forever or silently adopts whoever later occupies its pane.

After restart or reconnect, reacquire only the original connection. Re-resolve
the native handle only when architect-protocol's binding resolver verifies the
original source identity. Connection ID plus a reused generation, pane name,
cwd, agent kind, or display label never establishes continuity. If the occupant cannot be verified, or the captured target state changed, record
not sent and preserve the answer for `ask get`. Definitive absence or replacement
is refused. No alternate
connection or replacement agent is selected automatically.

### One answer intent and one effect path

Declare `world.ask.deliver-answer` version 1 as its own queueable,
state-conditioned verb, with recovery class `opaque`. This verb delivers one
ask's stored answer to that ask's original bound asker. It uses Chat's guarded
send path without making Chat sends or terminal input queueable.

Capture the state condition when the answer is recorded: the original asker
binding has the same captured session fingerprint, and the ask still awaits
delivery (not withdrawn or delivered). The merged world-effects offline-answer
scenario governs an unavailable host: preserve the previously verified binding
as unresolved and keep delivery pending until it can be checked. An outage alone
cannot establish that the session changed. A confirmed ended/changed or never-
verified binding records not sent, leaving the answer available through `ask get`.

When the owner or an authorized other agent answers, one transaction commits:

1. The immutable answer and its occurrence/revision.
2. One `world.ask.deliver-answer` outbox entry keyed by kind and ask ID, carrying the captured
   recipient binding, operation version, answering actor and authorization
   evidence, state condition and opaque origin. Parameters contain only ask ID
   and answer occurrence. The dispatcher reads current answer
   text from the ask; the intent does not duplicate message text.
3. The ledger revision/change entry needed to publish that durable answer.

PR 2 starts with a short due delay (initially 3 seconds, through the injected
clock/scheduler) so a held `--wait` request normally consumes the answer first.
This delay is coordination, not proof of delivery or a latency guarantee.
Already answered asks from PR 1 are not backfilled into the send queue. Existing
unanswered asks without a captured binding stay answerable but cannot acquire a
recipient from a later occupant.

The outbox owns retry/recovery of the answer intent. Chat owns its single send
path and delivery evidence. The adapter must not add an independent durable
agent-input queue. A successful Chat send advances the existing intent; a retry
does not create a new message queue or a second outbox row.

Prompt format is plain explanatory text:

```text
Answer to q-example:
Question: Continue with the fixture?
Answer from owner: Yes.
```

The fixed prefix precedes all user text. Never send an answer as a slash command,
shell command, memory directive or simulated keypress. Preserve the whole answer;
if a bounded prompt cannot fit, send a bounded plain-text instruction to retrieve
the answer with `herdr-world ask get ID`, and record that a pointer was queued.

### Dispatch and evidence

At a due wake, use the original connection's current lease. Before claiming,
claim atomically against the answer occurrence, with the current service
incarnation and attempt fence. Claiming alone is not dispatching. After claim,
recheck current authorization, the captured state condition, freshly resolved
binding and supported operation version. Authorization uses the answering
actor's policy for this ask: an owner-only ask remains owner-only. Persist
`dispatching` only after those checks, then pass the captured conversation
fingerprint into Chat's send path. A crash after claim but before dispatching
can re-claim after checks; once dispatching was persisted, any doubt is uncertain
and requires an authorized decision. Chat performs its existing immediate session
check, submission and outcome verification. Record the actual result with the
attempt fence. `delivered` means the evidence says the original session was
queued the plain-text answer, or that the verified asker received it through the
CLI; it does not mean the model acted on it or a human read it.

| Observation | Result and permitted next step |
| --- | --- |
| Verified asker acknowledges the exact answer before dispatch | `delivered`; no pane send |
| Ask withdrawn before dispatch | `cancelled`; no pane send |
| Occupant cannot be verified, original binding changes, or ask no longer awaits delivery | Record not sent; preserve the answer for `ask get` |
| Chat unsettled or `agent_blocked` proves no submission while the attached binding/state condition still holds | `pending` with bounded backoff; recheck authorization, binding and version on every attempt |
| Definitive pane absence, replaced session, unverified asker or missing binding | `refused`; preserve the answer and explain retrieval |
| Chat proves the original session accepted/queued the answer | `delivered` with actual queue evidence |
| Timeout, disconnect after possible submission, unknown reply, post-send session mismatch, crash in `dispatching` | `uncertain`; no automatic resend |
| Old attempt reports after a newer authorized attempt | Ignore the stale receipt; it cannot finish the new attempt |

Attempt detail retains the newest eight attempts plus the newest uncertain
attempt, at most nine rows per intent. Older safe retries are pruned; a retained
uncertainty marker prevents later pending/refused evidence from implying that no
earlier send happened. Status/detail queries and their pages stay bounded.

No age-only policy discards pending work. A failed state condition is resolved
explicitly as not sent, rather than silently waiting for a different occupant.
The answer's lifetime is independent of the attempt and change-log retention.
All waits persist wall deadlines, arm for at most 60 seconds, and recheck wall
time on wake, including after sleep.

### Coordinate with `ask get` and `--wait`

Only the original verified asker can settle delivery by reading; an owner's
inspection or another agent's `ask get` must not cancel the asker's notification.
Match the captured occupant/session, not merely the pane or connection ID.

The CLI must receive the exact answer and successfully write it to stdout before
acknowledging. A failed or interrupted stdout write produces no acknowledgement.
Constructing an HTTP response or buffering output does not prove receipt. The
CLI can then send an authenticated internal acknowledgement
through the same service route. The service checks the actor and occurrence and
atomically settles a still-pending intent with evidence `received by asker CLI`.
A missing acknowledgement is not proof of a read. The reply includes its current
attempt fence, which the acknowledgement must echo along with the answer
occurrence. Repeated acknowledgements are idempotent; stale ones cannot settle a
newer occurrence or attempt. A claim that wins this race can make an older read
receipt stale, so no exactly-once claim is made.

If a pane send has already started when the CLI acknowledges, it cannot be
retracted. Retain both pieces of evidence and permit that one in-flight send to
finish. The 3-second delay avoids the common duplicate, but no exactly-once
delivery claim is made across these two paths. Lost acknowledgements and races
are explicit test cases. `ask get` always remains available, including after an
uncertain send, closed delivery, or a failed acknowledgement request.

### Visible uncertainty and owner decisions

Answered asks leave the open-question list, so `world.asks.get` alone cannot
expose delivery recovery. Add a bounded delivery-notice query/subscription for
unresolved/uncertain answer intents, keyed by ask ID and answer occurrence. Its
count is separate from unanswered questions. Do not resurrect a question or
change Town/Desk attention counts just to display a delivery problem.

Reception must expose the question, answer, captured recipient, latest evidence
and two explicit owner decisions: **Resend** and **Close delivery**. Opus owns
their final placement and interaction design within the existing Reception look.
`ask get ID --json` also returns the delivery state/reason. No text or session
identifier is copied into browser storage solely for delivery recovery.

Resend confirms possible duplication, keeps the same outbox row and immutable
recipient, increments the attempt and revalidates current authority and identity
before sending. It cannot silently authorize a replacement agent. Close delivery
records cancellation without removing the answer. Only the owner may make these
decisions; an old browser response or a stale attempt cannot override them.
Recovery controls are delivery operations, not a workflow authoring model.

### Acceptance before PR 2 is ready

Use requirements-derived finite schedules through the production storage,
dispatcher and Chat adapter, plus real temporary SQLite/source/compiled tests.

| Boundary | Required allowed/forbidden evidence |
| --- | --- |
| Normal answer without `--wait` | One plain-text prompt reaches the verified original session; answer remains retrievable |
| Held `--wait` / direct asker read | Exact-answer CLI acknowledgement settles pending delivery; other readers do not |
| Read/send race and dropped acknowledgement | No false read claim, no lost answer; only an already started send may still arrive |
| Identity | Unverified, missing, guessed or wrong-scheme fingerprints never send; replacement/reused pane and restart generation collisions never retarget |
| Existing Chat policy | Blocked/unsettled/unsupported hosts remain unsent; command-like answer text stays plain text |
| Crash windows | Before/after claim, after submission, and before/after receipt commit; uncertain attempts never replay automatically |
| Owner recovery | Explicit resend rechecks original recipient; close preserves answer; stale decisions/receipts cannot finish another attempt |
| Lifecycle | Close cancels scheduled wakes, drains started dispatch before connections/storage stop; reopen preserves unresolved evidence |
| UI | Answered uncertain delivery stays visible without re-opening the question or double-counting attention; trusted recovery controls are independently reviewed |

Keep existing conversation race/browser evidence and all mandatory consumers.
Update Q29 and the storage contract when PR 2 is implemented; these planned cases
are not counted as executed coverage. Native Herdr sends remain non-idempotent.
The proposed upstream operation-key/receipt/session-fence request is recorded in
the seat's research file; implementing that upstream capability is outside PR 2.

### Dismissals

Dismissals remain visible through `ask get` and `--wait`; this answer-only verb
does not send them as pane messages or invent answer text. Withdrawal cancels an
undispatched answer intent, while preserving any already recorded answer. A
separate dismissal-delivery verb would require its own product decision.

## Risks / Trade-offs

- Herdr has no atomic session fence or operation receipt: preserve Chat's checks
  and evidence; uncertain submission never auto-replays.
- Output and acknowledgement can race pane submission: the initial delay reduces
  the common duplicate, while one already-started send may still arrive.
- Incomplete identity or changed policy prevents delivery: record not sent and
  retain the answer for retrieval; never choose a substitute recipient.
- Answered asks leave the open-question list: a separate bounded notice query
  carries recovery without resurrecting questions or inflating attention counts.

## Migration Plan

Introduce binding/answer occurrence and attempt phase/version fields together
with the consumer and acknowledgement. Retain imported IDs. Create no send rows
for already answered records. Ineligible legacy asks remain retrievable and
record delivery refusal. Preserve pending/uncertain intents and evidence across
upgrades; unsupported versions admit no effect. A downgrade requires the normal
private storage backup and cannot silently resume an unsupported effect.

### Reception interaction

The authorized design uses one compact Outbox row in the existing rail, opening
Town Summary at the Outbox heading. Only uncertain/refused answers contribute
to that row and its inset; pending/claimed/dispatching answers stay in Summary.
The original host's reception sign has a separate `✉N` tag for saved answer
work. These counts never contribute to open questions or blocked agents.
Aggregates cover the whole outbox even when its detail page is limited to 60.

Claimed and dispatching both show Sending with no UI decision. Unconfirmed
answers offer Send again with explicit duplicate confirmation, or Dismiss;
pending answers offer Cancel send. Not-sent answers offer Dismiss and an
explicit Open agent/terminal route only when the current original terminal can
be located; that route never changes the saved send recipient or prefills input.
Details expose bounded attempt evidence and retrieval. Focus moves into duplicate
confirmation, back on Cancel, and to the next card/Outbox heading after removal;
one polite status announces the result. Details have 32/40 pixel tap targets.
A temporary Sent card requires an exact positive status read; CLI receipt is
named separately. Up to five such cards live only in memory until another
refresh. No Chat transcript badge is added in this PR.
