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

World SHALL acknowledge Sent only after committing the message and its
per-recipient delivery intents. Each message SHALL carry an idempotency key,
explicit thread, sender claim, body and recipients. Duplicate submission SHALL
return the existing intent. Pending intents SHALL survive compaction without
being expired solely because they have waited.

#### Scenario: Client retries an accepted send
- **WHEN** a client resubmits the same idempotency key after losing the response
- **THEN** World returns the accepted message without creating another delivery

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
in the bound occupant's transcript. Ambiguous text, a working status or missing
evidence SHALL NOT advance a receipt. Confirmed receipt evidence SHALL NOT
regress because a source disconnects. Viewer seen/reviewed state SHALL remain
separate from message-consumption receipts.

#### Scenario: Same text cannot be matched uniquely
- **WHEN** transcript evidence cannot distinguish two deliveries with equal text
- **THEN** neither ambiguous match is promoted to Read

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
