## ADDED Requirements

### Requirement: Answer delivery checks the current foreground program

Immediately before typing an ask question or answer, World SHALL check only the runtime-reported foreground group leader's executable basename, ignoring arguments and children. Shells, REPL interpreters, editors/pagers, ssh, sudo/su, database clients, tmux/screen/zellij and docker SHALL receive no input. Other basenames SHALL be admitted. Missing foreground information SHALL preserve pre-change behavior without tty or /proc inspection.

#### Scenario: Agent exits to its shell

- **WHEN** the agent exits to bash before answer recording, dispatch or the final native input check
- **THEN** World types nothing, records Not sent with a plain shell reason in Reception, and `herdr-world ask get <id>` returns the saved answer
- **AND** a later program does not revive that refused delivery

#### Scenario: Shell options and nested shell launchers

- **WHEN** the leader is bash --rcfile, bash --init-file, bash -o vi, zsh -o, a shell script/-c launcher, tmux, screen, zellij, docker exec -it with sh, or busybox sh
- **THEN** no input is sent regardless of arguments or stale agent metadata

#### Scenario: Agent has child processes

- **WHEN** an admitted leader has MCP helpers or shell, editor, interpreter or other children
- **THEN** children do not affect admission, regardless of their arguments or stdin
- **AND** a shell started inside a live harness remains a documented limit of this check

#### Scenario: Agent restarts

- **WHEN** a resumed, restarted, different or unknown agent executable now runs at the same qualified terminal
- **THEN** the basename check allows input unless the leader is in a refused category
- **AND** it does not require original-session evidence or hash foreground PIDs

#### Scenario: Runtime provides no foreground information

- **WHEN** macOS, a remote core or a Herdr TUI supplies no foreground leader information
- **THEN** the new check does not block input or probe the host; pre-existing delivery qualification still applies

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
