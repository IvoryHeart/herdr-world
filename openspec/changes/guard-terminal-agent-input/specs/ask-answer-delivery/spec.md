## ADDED Requirements

### Requirement: Only the original agent foreground receives an answer

World SHALL type an ask's question or answer only while fresh native foreground evidence identifies the original asking harness and session at its captured terminal, connection and generation. A shell, editor, different harness, replacement agent process or unknown foreground SHALL be treated as not attached, even if an old agent/session report remains. Historical recipients lacking original foreground evidence SHALL keep saved answers readable through the CLI without automatic delivery.

#### Scenario: Agent exits to its shell

- **WHEN** the original agent exits to bash before answer recording, dispatch or the final native input check
- **THEN** World types nothing, records not-attached/not-delivered evidence visible in Reception, and `herdr-world ask get` returns the saved answer
- **AND** a later agent in the terminal does not revive that refused delivery

#### Scenario: Session report survives foreground replacement

- **WHEN** the terminal retains the original session report but its foreground is an editor, another harness, unknown, or another process of the same harness
- **THEN** original-recipient validation refuses delivery and preserves the answer for retrieval

#### Scenario: Core holds input while the foreground changes

- **WHEN** core holds a native answer send and World observes a foreground or qualified-runtime change
- **THEN** World cancels the held send and never automatically retries a possible send into another session
- **AND** a lost or ambiguous send reply remains uncertain rather than authorizing replay

#### Scenario: A harness opens a shell or editor child

- **WHEN** the foreground group still has the original harness leader but also contains a shell, editor or pager
- **THEN** no answer is typed and Reception records Not sent while preserving the saved answer
- **AND** original foreground evidence covers every member PID and name

#### Scenario: Temporary read failure and changing titles

- **WHEN** World cannot read foreground or agent information due to a temporary RPC/read failure
- **THEN** delivery remains waiting and retries only after rechecking the original binding
- **AND** title, status sequence and observation revision changes alone do not count as a different session

#### Scenario: Restart, resume and upgrade

- **WHEN** the agent restarts or resumes as a new process, or a question was open when World restarted or upgraded
- **THEN** automatic delivery does not reattach, Reception shows Not sent when answered, and `herdr-world ask get <id>` returns the saved answer

#### Scenario: Owner recovers an undelivered answer

- **WHEN** an owner opens an undelivered answer in Reception > Outbox
- **THEN** Not sent explains that the agent that asked is no longer running there and names `herdr-world ask get <id>`
- **AND** Copy answer copies the saved owner answer; Put in Terminal composer appends it to that terminal's qualified draft and opens its composer on desktop or phone without typing or sending input
- **AND** a missing or replaced terminal cannot receive that draft through the saved placement

## MODIFIED Requirements

### Requirement: Capture and recheck the original bound state

At answer recording World SHALL capture the original verified binding's session
fingerprint and that the ask still awaits delivery, not withdrawn or delivered.

#### Scenario: Answer delivery qualification

- **WHEN** World records or attempts answer delivery
- **THEN** An offline/unobserved host SHALL keep that binding unresolved and delivery pending
  until it can be checked while this World service keeps running; an outage SHALL NOT count as a changed session. After claiming, World SHALL recheck the answering
  actor's current ask policy, target binding, preconditions and operation version.
  Unverifiable or changed state SHALL record not sent and preserve ask retrieval.

#### Scenario: Answer recorded during an outage
- **WHEN** the user answers a previously bound ask while its original host is offline
- **THEN** the intent remains pending without expiry while the World service and original agent process keep running
- **AND** it sends only after that same session is verified on return

#### Scenario: Reused pane or generation after restart
- **WHEN** World restarts or upgrades, the harness restarts/resumes as a new process, or the native handle exists but the original source/session cannot be verified
- **THEN** nothing is sent and the answer remains available through ask get

#### Scenario: Owner-only authority remains owner-only
- **WHEN** the captured answering actor no longer satisfies the ask's current policy
- **THEN** no dispatch begins even if an old intent or attempt was committed
