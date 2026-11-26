## MODIFIED Requirements

### Requirement: Ask ownership across World instances

The World instance that records an ask (its home) SHALL remain its only
authority: its ledger accepts at most one answer or dismissal, and answer
delivery SHALL use only the home's own qualified connection and generation.
A herdr-core or Herdr runtime SHALL NOT hold the ask record.

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
