# Ask answer delivery

## Purpose

Deliver one stored ask answer to its verified original asker while preserving
retrieval, explicit authority and honest uncertain-effect recovery.

Delivered in PR #589; the [November audit](../../../verification/architecture-audit-2026-11.md)
reconciles its clean follow-up review, merged Delivery checks and current crash
consumers. No Herdr exactly-once delivery or downstream deduplication is claimed.

## Requirements

### Requirement: Answer attachments retain their upload authority

An owner MAY attach files or screenshots to an answer. The answer SHALL carry
their temporary stored paths as plain text under `Attached files:`, identically
for saved retrieval and automatic delivery.

#### Scenario: Attachment placement and limits

- **WHEN** an owner attaches files or screenshots to an answer
- **THEN** Uploads SHALL use the placed asker's
  qualified connection, or that same saved connection's current ready runtime
  when unplaced. Only an asker with no connection placement MAY use a ready local
  World connection. A known unavailable remote host SHALL NOT fall back locally.
  Existing upload limits, retention and answer-length limits SHALL apply.

#### Scenario: Attachment upload or answer validation fails

- **WHEN** an upload fails, the asker's host is unavailable, or the combined answer exceeds its bound
- **THEN** the answer is not submitted as though all attachments succeeded;
  the owner sees the failure and can retry or remove the attachment

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

#### Scenario: Answer delivery qualification

- **WHEN** World records or attempts answer delivery
- **THEN** An offline/unobserved host SHALL keep that binding unresolved and delivery pending
  until it can be checked; an outage SHALL NOT count as a changed session. After claiming, World SHALL recheck the answering
  actor's current ask policy, target binding, preconditions and operation version.
  Unverifiable or changed state SHALL record not sent and preserve ask retrieval.

#### Scenario: Answer recorded during an outage
- **WHEN** the user answers a previously bound ask while its original host is offline
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
without changing their counts. The user SHALL be able to explicitly resend to
the same reverified recipient or close delivery while preserving the answer.
Stale decisions/attempt receipts SHALL not finish a later attempt. Dismissals
SHALL retain retrieval semantics without being sent as invented answers.

#### Scenario: Answered ask has uncertain delivery
- **WHEN** the question is answered but its pane delivery is uncertain
- **THEN** a bounded delivery notice remains available with evidence and user recovery
- **AND** the question is not reopened or counted as unanswered

### Requirement: Ask ownership across World instances

The World instance that records an ask (its home) SHALL remain its only
authority: its ledger accepts at most one answer or dismissal, and answer
delivery SHALL use only the home's own qualified connection and generation.

#### Scenario: Home authority and shared instance visibility

- **WHEN** World records, shares or resolves an ask across instances
- **THEN** A herdr-core or Herdr runtime SHALL NOT hold the ask record.

  World instances running as the same user on the same machine SHALL share a
  private per-user instance registry by default, independently of their data
  folders. `HERDR_WORLD_INSTANCE_REGISTRY_DIR` SHALL override that location;
  question storage SHALL remain in each World's own data folder. Registry
  directories and reports SHALL be user-only (0700 and 0600 on Unix).
  Other World instances that share the home's registry and at least one runtime
  (the same connection target) SHALL show the
  home's open asks for that runtime in Needs you, with the home's name. An ask's
  runtimes SHALL be captured when it is recorded (the asker's connection target,
  and the default Herdr target that alerts for a herdr-core or unplaced asker)
  and SHALL NOT follow later edits of saved connections; the home's report SHALL
  list the runtimes of its open asks as well as the ones it connects to. An ask
  recorded before this capture existed stays in its home only. Each
  registry report SHALL carry a per-run peer token; the home SHALL serve its asks
  only over loopback, without a browser Origin, to that token, and only for the
  runtimes the requester names and shares. Shared asks SHALL NOT carry connection,
  pane, terminal or session identifiers, attachments or delivery evidence. An
  answer or dismissal from another instance SHALL be forwarded to the home, which
  applies it as the owner's; a refusal (already closed) SHALL be shown, not
  retried elsewhere.

  The owner alert SHALL name the home (`<question> (<id>, asked in <World>)`)
  within Herdr's 400-character notification body: a long question is shortened
  with an ellipsis, never the ID or home, and any World name Settings accepts,
  parentheses included, SHALL be read back from the alert. An
  instance that receives an alert whose ask it cannot read SHALL show an
  alert-only entry naming the home, with a link when its registry reports that
  World, and SHALL NOT offer an answer there. Such entries are bounded, held in
  memory and closed by hiding them or once the home shares the ask.

#### Scenario: Answered from another World

- **WHEN** an agent asks through World A and the owner answers in World B on the same runtime
- **THEN** B forwards the answer to A, A records it once and delivers it through its own connection
- **AND** both Worlds stop listing the question
- **WHEN** the owner answers in A and B at the same moment
- **THEN** exactly one answer is recorded and the other is refused as closed

#### Scenario: Different data folders discover by default

- **WHEN** Worlds A and B run as the same user on this machine with different data folders, no registry override and the same runtime target
- **THEN** a question recorded in A appears in Needs you in both Worlds
- **AND** answering in either World closes it in both, with A retaining the only record

#### Scenario: Connection edited after the ask

- **WHEN** an agent asks through saved connection S on runtime A and S is then edited to target runtime B
- **THEN** Worlds on A keep listing the question and Worlds only on B do not see it

#### Scenario: Home down, older or not shared

- **WHEN** an older World (including 0.3.5) publishes no registry report
- **THEN** it contributes no peer questions and its absence causes no discovery error
- **WHEN** the home stops, its report leaves the registry
- **THEN** other Worlds stop listing its asks at their next read and refuse to forward answers
- **WHEN** a read fails while the home still reports
- **THEN** the last list stays for at most 15 seconds, then leaves
- **WHEN** an older home, or one with a separate registry, sends an alert
- **THEN** other Worlds show an alert-only "asked in <World>" entry (or "another World") instead of nothing

### Requirement: Owner alerts for herdr-core askers use a Herdr connection

herdr-core has no owner notifications, so an owner alert for a question from a
herdr-core terminal or from an unplaced asker SHALL go through a Herdr
connection: the default connection when it is a Herdr connection, otherwise
the first saved Herdr connection on this computer.

#### Scenario: Captured Herdr alert routing

- **WHEN** a core or unplaced asker records a question
- **THEN** It SHALL NOT target a
  herdr-core connection. The connection SHALL be captured when the question is
  recorded and SHALL also be the ask's alert runtime; dispatch SHALL use only that
  connection's current lease and SHALL NOT fall back to another connection. With
  no such connection, World SHALL record the alert as not sent, and Needs you and
  Town SHALL say under the question that the owner was not alerted.

#### Scenario: herdr-core default host
- **WHEN** the default host is a herdr-core connection, this computer has a saved Herdr connection, and a verified herdr-core agent asks the owner
- **THEN** the owner alert is shown through that Herdr connection

#### Scenario: No Herdr connection can alert
- **WHEN** a herdr-core agent asks and World has no Herdr connection on this computer
- **THEN** no alert is sent to any connection, the question is saved, and Needs you says World did not alert the owner
