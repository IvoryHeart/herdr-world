## ADDED Requirements

### Requirement: Answer delivery checks the current foreground program

Immediately before typing an ask question or answer, World SHALL check the current foreground program and foreground children. Shells, interactive REPLs, editors/pagers, ssh, sudo/su and database clients SHALL receive no input. Other programs SHALL be admitted without original harness/session or PID matching. Failed reads SHALL leave delivery pending for a fresh check.

#### Scenario: Agent exits to its shell

- **WHEN** the agent exits to bash before answer recording, dispatch or the final native input check
- **THEN** World types nothing, records Not sent with a plain shell reason in Reception, and `herdr-world ask get <id>` returns the saved answer
- **AND** a later program does not revive that refused delivery

#### Scenario: A foreground child reads the terminal

- **WHEN** an agent leader has an interactive shell, REPL, editor/pager or ssh child in its foreground group
- **THEN** no answer is typed, even when stale agent/session reports remain

#### Scenario: Agent restarts or runs through a launcher

- **WHEN** a resumed, restarted, different or unknown agent, wrapper script or npm entrypoint now runs at the same qualified terminal
- **THEN** the current program check allows input unless a refused interactive program is reading the terminal
- **AND** it does not require original-session evidence or hash foreground PIDs

#### Scenario: Temporary foreground read failure

- **WHEN** the current program cannot be read
- **THEN** World types nothing and says to try again shortly; a saved answer remains pending and a fresh attempt rechecks the terminal

#### Scenario: Owner recovers an undelivered answer

- **WHEN** an owner opens an undelivered answer in Reception > Outbox
- **THEN** Not sent explains the refused foreground in plain words, offers Copy answer and shows the full `herdr-world ask get <id>` command
- **AND** Put in Terminal composer opens its qualified draft on desktop or phone without sending input, preserving existing draft text

#### Scenario: Foreground changes while core holds a send

- **WHEN** World observes a foreground or qualified-runtime change while core holds input
- **THEN** World cancels the held send and never automatically replays a possible send

## MODIFIED Requirements

### Requirement: Capture and recheck the original bound state

World SHALL retain the original qualified terminal and answering authority, and check that the ask still awaits delivery. Foreground admission SHALL use the current program rather than the original asking agent/session.

#### Scenario: Answer delivery qualification

- **WHEN** World records or attempts answer delivery
- **THEN** an offline/unobserved host keeps delivery pending until the qualified runtime can be checked; an outage is not a permanent refusal
- **AND** World rechecks answering authority, terminal identity, preconditions and operation version before dispatch

#### Scenario: Answer recorded during an outage

- **WHEN** the owner answers an ask while its host is offline
- **THEN** the answer remains pending and retrievable, and sends only after the qualified host returns and its current foreground passes admission

#### Scenario: Reused pane or generation after restart

- **WHEN** the original terminal ended or its qualified runtime was replaced
- **THEN** no fallback or replay targets another terminal or connection, and ask get retains the answer

#### Scenario: Owner-only authority remains owner-only

- **WHEN** the answering actor no longer satisfies the ask policy
- **THEN** dispatch does not begin
