## Purpose

Deliver one stored ask answer to its verified original asker without requiring a
waiting CLI, while preserving retrieval and explicit uncertain-effect recovery.

## ADDED Requirements

### Requirement: A distinct state-conditioned answer verb

World SHALL declare world.ask.deliver-answer as a queueable, opaque verb that
delivers exactly one ask's stored answer to its bound asker. The intent SHALL
reference ask and answer occurrence, not copy answer text. Chat sends and
terminal input SHALL remain direct and non-queueable.

#### Scenario: Answer without a waiting CLI
- **WHEN** an eligible bound ask receives an authorized answer without --wait
- **THEN** one reference-only delivery intent commits with the stored answer
- **AND** dispatch reads that ask's stored text through the existing guarded path

#### Scenario: Existing answered records
- **WHEN** this capability is enabled on an existing database
- **THEN** historical answered asks are not backfilled into pane delivery

### Requirement: Capture and recheck the original bound state

At answer recording World SHALL capture the original verified binding's session
fingerprint and that the ask still awaits delivery, not withdrawn or delivered.
An offline/unobserved host SHALL keep that binding unresolved and delivery pending
until it can be checked; an outage SHALL NOT count as a changed session. After claiming, World SHALL recheck the answering
actor's current ask policy, target binding, preconditions and operation version.
Unverifiable or changed state SHALL record not sent and preserve ask retrieval.

#### Scenario: Answer recorded during an outage
- **WHEN** the owner answers a previously bound ask while its original host is offline
- **THEN** the intent remains pending without expiry
- **AND** it sends only after that same session is verified on return

#### Scenario: Reused pane or generation after restart
- **WHEN** the native handle exists but the original source/session cannot be verified
- **THEN** nothing is sent and the answer remains available through ask get

#### Scenario: Owner-only authority remains owner-only
- **WHEN** the captured answering actor no longer satisfies the ask's current policy
- **THEN** no dispatch begins even if an old intent or attempt was committed

### Requirement: Opaque attempt recovery and plain-text submission

A claim SHALL precede authorization/binding/version rechecks. World SHALL then
persist dispatching before submission. A crash after claim alone SHALL permit
reclaim after checks; any doubt after dispatching SHALL become uncertain without
automatic replay. Submission SHALL retain guarded lease/session/input admission
and a fixed plain-text prefix so owner text cannot become a command.

#### Scenario: Crash after possible submission
- **WHEN** a process stops after dispatching but before recording decisive evidence
- **THEN** delivery is visible uncertain and requires an authorized decision

#### Scenario: Command-like answer text
- **WHEN** an answer starts with a slash, exclamation mark or memory directive
- **THEN** the delivered message is prefixed plain text and does not invoke that command

### Requirement: Verified asker acknowledgement after output

Only the original verified asker SHALL settle an intent by acknowledging its
exact answer occurrence. The CLI SHALL acknowledge only after successfully
writing that answer to stdout. Other readers and stale acknowledgements SHALL
not suppress delivery. An already-started pane send cannot be retracted.

#### Scenario: Waiting asker receives the answer
- **WHEN** the verified asker writes the exact answer to stdout and acknowledges it before dispatch
- **THEN** the pending intent is settled without a pane send

#### Scenario: Interrupted or failed output
- **WHEN** output fails or the CLI stops before writing the answer
- **THEN** no acknowledgement is sent and constructing the server reply alone does not settle delivery

### Requirement: Owner-visible recovery without reopening the question

World SHALL expose uncertain answer delivery separately from open questions,
without changing their counts. The owner SHALL be able to explicitly resend to
the same reverified recipient or close delivery while preserving the answer.
Stale decisions/attempt receipts SHALL not finish a later attempt. Dismissals
SHALL retain retrieval semantics without being sent as invented answers.

#### Scenario: Answered ask has uncertain delivery
- **WHEN** the question is answered but its pane delivery is uncertain
- **THEN** a bounded delivery notice remains available with evidence and owner recovery
- **AND** the question is not reopened or counted as unanswered
