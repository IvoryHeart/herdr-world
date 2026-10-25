## Purpose

Provide one evidenced account of source changes, message delivery and agent
working-tree bindings while preserving source authority and qualified runtime
ownership across World views.

## ADDED Requirements

### Requirement: Qualified source capture and replay

World SHALL retain source identity/incarnation, event identity or observation
revision, provenance and freshness for captured changes. Runtime observations
SHALL be qualified by connection ID and generation, and by occupant/session
where applicable. Consumers SHALL tolerate replay without duplicating facts.
An expired cursor SHALL produce an explicit gap and consistent snapshot/cursor
reset. A source outage SHALL mark observations stale rather than imply deletion.

#### Scenario: Replayed observation
- **WHEN** a source repeats the same event after reconnecting
- **THEN** World exposes one logical observation with its original provenance

#### Scenario: Cursor outside retention
- **WHEN** a consumer resumes before the retained cursor floor
- **THEN** World reports the gap and requires a consistent snapshot/cursor reset
  instead of presenting a silently incomplete event history

#### Scenario: Source becomes unavailable
- **WHEN** a connection fails without positive evidence of deletion
- **THEN** retained observations are stale and non-actionable, not deleted

### Requirement: Durable message intents

World SHALL acknowledge Sent only after committing the message and all
per-recipient intents atomically. Each message SHALL carry an explicit thread,
sender claim, body, recipients and requested delivery/target conditions.
Idempotency SHALL be scoped by World ledger incarnation, service-issued stable
producer ID and client key; sender labels SHALL NOT define that namespace.
A canonical fingerprint SHALL compare all request fields, preserving exact
body content and normalizing the recipient set. An identical retry SHALL
return the existing message/status without re-resolving recipients. A changed
payload under the same namespace/key SHALL return `idempotency_conflict`
without mutation or dispatch. Concurrent submissions SHALL enforce this same
uniqueness rule transactionally.

Accepted key/fingerprint mappings SHALL survive message compaction under a
finite deduplication budget. Exhaustion SHALL reject new keys rather than
forget accepted ones. Explicitly retired namespaces SHALL reject stale retries;
unknown producer IDs SHALL NOT be created implicitly by send or reused.
Retirement SHALL NOT discard unresolved messages. New registration SHALL NOT
be treated as an automatic retry of uncertain delivery.

#### Scenario: Client retries an accepted send at capacity
- **WHEN** a client resubmits the same namespace/key and payload after losing
  the response, while admission is full
- **THEN** World returns the accepted message without another delivery or a
  new-capacity refusal

#### Scenario: Key reused for a different recipient or body
- **WHEN** an accepted namespace/key is submitted with different content,
  thread, sender claim, recipients or delivery conditions
- **THEN** World reports idempotency_conflict and leaves the original message
  and delivery records unchanged

#### Scenario: Same key in different producer namespaces
- **WHEN** two registered producers submit the same client key
- **THEN** each is admitted independently subject to quotas, without collision

#### Scenario: Retry after namespace retirement
- **WHEN** an old accepted request is retried under a retired producer ID
- **THEN** World rejects that namespace instead of dispatching a new message

### Requirement: Producer continuity across client processes

World SHALL issue producer IDs through explicit, idempotent registration and
persist the mapping from a client bootstrap ID and ledger incarnation. Clients
SHALL durably store the bootstrap ID before registration and the producer ID
before sending. Lost registration replies SHALL recover the same mapping.
Owner UI SHALL keep its profile and pending journal in same-origin browser
storage shared transactionally across its tabs. CLI processes SHALL reopen a
named producer profile and journal in per-user client state scoped to the World
service/ledger, rather than registering on each invocation. Registration and
journals SHALL have finite quotas; persistence failure SHALL block sending.

Before transport, clients SHALL persist the request ID and canonical request.
CLI retry SHALL re-present the same profile, request ID and payload or load
that journal entry explicitly. Unresolved requests SHALL be exposed before a
default new send; a deliberate additional send SHALL require an explicit new
request ID. Equal text alone SHALL NOT be a retry key. Concurrent processes
SHALL serialize journal writes. Lost state, a changed ledger incarnation or
retired namespace SHALL require explicit recovery, without automatically
registering a replacement or retrying uncertain requests under new keys.

Producer identity SHALL confer no sender authentication or seat authority.
Seat/occupant associations SHALL require an explicit service assignment record
and revision; inherited handles SHALL NOT prove tool-process identity.
Unverified sender binding SHALL remain reported/unknown pending task 5.3's
capability evidence; it SHALL NOT be inferred from a pane name or environment.

#### Scenario: CLI re-run after a lost response
- **WHEN** a new CLI process selects the same persisted producer profile and
  request ID after World accepted the send but the prior process lost its reply
- **THEN** World returns the original message/status without another dispatch

#### Scenario: Client crashes during registration
- **WHEN** the client restarts with its persisted bootstrap ID after losing
  the registration response
- **THEN** registration returns the original producer ID rather than a new namespace

#### Scenario: Request journal lost after an uncertain send
- **WHEN** the client cannot recover the producer/request handle for that send
- **THEN** it reports recovery required rather than treating a fresh registration
  or equal text as a safe retry

### Requirement: Bounded admission for nonexpiring pending intents

World SHALL enforce finite payload/metadata bytes, recipient fan-out, global
and per-recipient unresolved count/byte limits, storage headroom and separate
deduplication limits before acceptance. Held and delivery-unknown intents SHALL
count toward capacity. Concurrent and multi-recipient admission SHALL check
and reserve capacity atomically, all-or-nothing. New requests beyond capacity
SHALL return `outbox_full` with limiting scope, or `message_too_large` for
payload/fan-out limits, without Sent, partial records or hidden overflow queues.
Consumers SHALL preserve unsent requests and show capacity pressure without
an automatic send loop. Capture retention SHALL preserve reserved capacity for
accepted intents and receipt updates.

Accepted pending intents SHALL survive compaction, restart and quota reductions
without expiry or silent eviction. Only confirmed terminal outcomes SHALL
release their pending capacity; cancellation SHALL require no dispatch or a
confirmed no-side-effect outcome. Unknown delivery SHALL require reconciliation.
Finite numeric settings and storage reserves SHALL be approved from synthetic
measurements before persistence implementation; no limit defaults to unbounded.

#### Scenario: Offline recipient fills its pending allowance
- **WHEN** accepted waiting messages exhaust that recipient's quota
- **THEN** another send to it is refused before Sent while previous messages
  remain durable, and another recipient can use remaining global capacity

#### Scenario: Concurrent senders compete for the last slot
- **WHEN** two new requests together exceed remaining admission capacity
- **THEN** only capacity-fitting requests commit, and refused multi-recipient
  requests create no partial deliveries

#### Scenario: Pending messages outlive retention or quota reduction
- **WHEN** history compacts or limits shrink below current pending usage
- **THEN** accepted pending messages remain intact and new admission waits for
  sufficient capacity instead of expiring or evicting accepted messages

### Requirement: Conditional delivery and standing

The intended delivery SHALL remain bound to the captured target connection,
generation and occupant and SHALL revalidate its admission conditions. Adapter
capabilities SHALL distinguish expected-session fencing from non-atomic prompt
admission. Detected pre-dispatch mismatch SHALL refuse the send. An explicitly
admitted owner prompt fallback SHALL disclose its non-atomic boundary and
reconcile post-check turnover as wrong-target or unknown/unconfirmed according
to evidence; it SHALL NOT promise an expected-session guarantee. This fallback
SHALL NOT imply admission of automatic or peer sends. Owner messages SHALL
retain user standing; peer delivery standing SHALL be declared and visible.
World SHALL NOT dispatch a peer-as-user fallback into an open ask or claim
atomic admission from sampled checks. Unsupported conditions SHALL leave a
visible hold. Uncertain side effects SHALL NOT be automatically resent.

#### Scenario: Occupant mismatch detected before dispatch
- **WHEN** the service observes a mismatch with the captured recipient before
  sending, or an expected-session adapter rejects that mismatch at dispatch
- **THEN** it refuses the send without silently rebinding to the replacement

#### Scenario: Occupant switches after the last non-atomic check
- **WHEN** an explicitly admitted owner prompt races with session turnover
  after its final check
- **THEN** World retains the intended binding and records wrong-target if
  evidence identifies another recipient, otherwise unknown/unconfirmed;
  it never claims that the final check prevented the race

#### Scenario: Peer fallback cannot establish safe admission
- **WHEN** an adapter cannot establish the required no-open-ask condition
- **THEN** the message remains held with an explicit reason

#### Scenario: Delivery outcome lost
- **WHEN** an adapter might have delivered but its result was lost
- **THEN** World reports delivery unknown and reconciles evidence without an
  automatic resend or a switch to another adapter

### Requirement: Evidence-based receipts

Delivered SHALL require documented acceptance for the intended bound recipient;
generic prompt success SHALL NOT suffice. Queue acceptance SHALL be labelled
queued and SHALL NOT imply consumption. Read SHALL require a matching turn
in the bound occupant's transcript. Message-ID correlation SHALL be validated
by the adapter. Exact-text fallback SHALL require a validated source
incarnation/session and transcript position or equivalent send-specific causal
boundary, plus a uniquely attributable eligible occurrence for this delivery.
Pre-existing or replayed older turns SHALL NOT qualify. Later World ingestion
or host-clock comparison alone SHALL NOT establish causality. Missing boundary
or competing identical inputs SHALL leave Read unconfirmed. Ambiguous text, a working status or missing
evidence SHALL NOT advance a receipt. Confirmed receipt evidence SHALL NOT
regress because a source disconnects. Viewer seen/reviewed state SHALL remain
separate from message-consumption receipts.

#### Scenario: Same text cannot be matched uniquely
- **WHEN** transcript evidence cannot distinguish two deliveries with equal text
- **THEN** neither ambiguous match is promoted to Read

#### Scenario: Old identical turn arrives after a new delivery
- **WHEN** a pre-existing or replayed turn uniquely matches a newly sent body
  but predates its validated source/send boundary, even if ingested later
- **THEN** World does not promote the new message to Read

#### Scenario: Missing causal boundary or competing matching input
- **WHEN** the adapter cannot correlate an exact-text occurrence to this send
  because its source boundary is missing or another identical input is possible
- **THEN** Read stays unconfirmed despite a matching string

#### Scenario: Agent starts working without receipt evidence
- **WHEN** the agent becomes working after a send
- **THEN** the status change alone does not advance delivery or read receipts

### Requirement: Preserve misdelivery and legacy Chat evidence

Evidence identifying a wrong recipient SHALL produce a distinct wrong-target
(misdelivered) outcome, preserving intended and observed target identities and
evidence provenance/basis. It SHALL remain visible in Reception and SHALL NOT
be reduced to unknown, Not sent or success for the intended target. Conflicting
later evidence SHALL retain the earlier claim with an explicit conflict.
Misdelivery SHALL stop attempts for that delivery and SHALL NOT be automatically
resent, including after acknowledgement or dismissal. A deliberate new send
SHALL require a separate owner action and request ID.

Migration SHALL import existing Chat sends as observations keyed by their
legacy delivery IDs, without scheduling them for delivery. pending SHALL map
to pending/unconfirmed; matched SHALL retain heuristic words/order evidence
below Read and SHALL NOT prove Delivered; uncertain SHALL map to unknown;
unverified SHALL retain its unconfirmed reason; misdelivered SHALL map to
wrong-target with its original evidence/basis. Stronger independently validated
receipts SHALL be preserved. A queued flag SHALL retain its queue meaning only.
Command outcomes SHALL NOT be silently converted to peer-message receipts.

#### Scenario: Native reply identifies another recipient
- **WHEN** a send intended for one occupant is reported accepted by another
- **THEN** World records the wrong-target outcome and both identities, exposes
  the incident and does not resend to either occupant automatically

#### Scenario: Heuristic legacy match is imported repeatedly
- **WHEN** the same legacy matched delivery is captured again
- **THEN** its delivery ID deduplicates the observation, no new send is queued,
  and the words/order match does not become a Read receipt

#### Scenario: Old transcript can no longer be checked
- **WHEN** a legacy unverified delivery is imported
- **THEN** its missing-evidence reason stays visible as unconfirmed rather than
  a false refusal or loss of a stronger independently proven receipt

### Requirement: Capture accepted worktree changes

Capture SHALL consume the delivered resolver governed by the existing
[Agent worktree source-control context](../../../../specs/world-surfaces/spec.md#requirement-agent-worktree-source-control-context).
It SHALL NOT create another evidence ranking, root selection or resource
admission algorithm. worktree-observed events SHALL describe accepted source
observations; binding-changed events SHALL describe accepted viewer selections.
Both SHALL retain source incarnation, connection/generation, pane/terminal/session,
observation revision and evidence references. Binding events SHALL also identify
the Inspector/view context and selection revision. Capture SHALL deduplicate
source/event kind/context/revision and reject retired or refused changes.
Replay SHALL preserve the observation-vs-selection distinction and SHALL NOT
reselect roots, authorize resources or create branch/PR ownership claims.

#### Scenario: Two Inspectors choose different trees
- **WHEN** two view contexts choose different candidates for the same subject
- **THEN** their accepted binding events remain distinct, without replacing
  the source's observed working-tree claim

#### Scenario: Retired worktree result or replay
- **WHEN** a retired generation produces a late result, or a consumer replays
  an already accepted observation/binding revision
- **THEN** no retired event is accepted, duplicate revisions remain one logical
  event, and replay performs no new root selection or file/Git operation

### Requirement: Shared read-model authority

Town, Board, Chat, Inspector and coordinator consumers SHALL read qualified
claims with the same provenance and freshness rules. Thread membership SHALL
be explicit. An agent reading events SHALL NOT create the viewer's seen or
reviewed claims. Coordinator digests SHALL reference source messages instead
of making the coordinator the authority for their content.

#### Scenario: Coordinator reads an owner's unread item
- **WHEN** a coordinator consumes a message through its inbox cursor
- **THEN** the owner's seen/reviewed state remains unchanged
