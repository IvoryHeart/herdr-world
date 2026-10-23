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

Delivery SHALL remain bound to the captured target connection, generation and
occupant and SHALL revalidate its admission conditions. Owner messages SHALL
retain user standing; peer delivery standing SHALL be declared and visible.
World SHALL NOT dispatch a peer-as-user fallback into an open ask or claim
atomic admission from sampled checks. Unsupported conditions SHALL leave a
visible hold. Uncertain side effects SHALL NOT be automatically resent.

#### Scenario: Occupant changes before dispatch
- **WHEN** the recipient's captured occupant no longer matches
- **THEN** World does not deliver to the replacement occupant and reports the
  changed target rather than silently rebinding the message

#### Scenario: Peer fallback cannot establish safe admission
- **WHEN** an adapter cannot establish the required no-open-ask condition
- **THEN** the message remains held with an explicit reason

#### Scenario: Delivery outcome lost
- **WHEN** an adapter might have delivered but its result was lost
- **THEN** World reports delivery unknown and reconciles evidence without an
  automatic resend or a switch to another adapter

### Requirement: Evidence-based receipts

Delivered SHALL require the adapter's documented target-acceptance evidence;
queue acceptance SHALL be labelled queued. Read SHALL require a matching turn
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

### Requirement: Evidenced working-tree observation

World SHALL associate worktree candidates with the current connection,
generation, pane/terminal and session fingerprint. Observations SHALL include
revision, time, availability/ambiguity/staleness and candidate provenance.
Evidence preference SHALL be live foreground cwd, the occupant's own bound
session cwd, then an actual branch match in a scoped known-repository worktree
list. Reports and inferences SHALL remain distinguishable. World SHALL NOT
infer ownership or choose another host or sibling checkout without evidence.

#### Scenario: Ambiguous branch match
- **WHEN** multiple candidates have equivalent inferred branch evidence
- **THEN** World exposes the ambiguity and candidate choice without claiming
  that any candidate is the agent's observed working tree

#### Scenario: Detached checkout
- **WHEN** a qualified candidate is a valid Git checkout with detached HEAD
- **THEN** the candidate remains available with a null branch

### Requirement: Shared Inspector binding

Files and Changes SHALL use one qualified selected worktree binding. The
service SHALL resolve the candidate root and revalidate binding revision,
session and generation before operations. Stale evidence SHALL NOT authorize
operations. Explicit viewer choice SHALL NOT rewrite the observed agent work
claim, native selection or branch/PR ownership. Remote roots SHALL be resolved
on their owning runtime rather than the World host.

#### Scenario: Viewer chooses another known worktree
- **WHEN** the viewer selects an offered worktree-list candidate
- **THEN** Files and Changes share that target while the observed agent working-tree claim remains unchanged

#### Scenario: Session turns over during root resolution
- **WHEN** the bound session or generation changes before an operation
- **THEN** World refuses the stale binding and does not fall back to workspace
  launch cwd or another candidate

### Requirement: Shared read-model authority

Town, Board, Chat, Inspector and coordinator consumers SHALL read qualified
claims with the same provenance and freshness rules. Thread membership SHALL
be explicit. An agent reading events SHALL NOT create the viewer's seen or
reviewed claims. Coordinator digests SHALL reference source messages instead
of making the coordinator the authority for their content.

#### Scenario: Coordinator reads an owner's unread item
- **WHEN** a coordinator consumes a message through its inbox cursor
- **THEN** the owner's seen/reviewed state remains unchanged
