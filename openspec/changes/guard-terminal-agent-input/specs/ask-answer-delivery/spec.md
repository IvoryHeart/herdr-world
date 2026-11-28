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

- **WHEN** a resumed, restarted, different or unknown agent executable now runs at the same qualified terminal while World keeps running
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

### Requirement: Saved answers survive a proven World restart

When World restarts with a saved answer waiting or a question still open, it SHALL deliver that answer only after proving that the original harness session still runs at the captured terminal. The proof SHALL use the session the harness runs now, never process IDs, executable names, launch arguments or per-run counters, and SHALL repeat at answer recording, at dispatch and before input.

#### Scenario: Herdr TUI proof

- **WHEN** a Herdr TUI recipient is resolved after a World restart
- **THEN** the proof is the same connection, pane and terminal and the same harness-reported session, checked before and after the foreground check, with the captured conversation scheme and session fingerprint

#### Scenario: herdr-core proof

- **WHEN** a herdr-core recipient is resolved after a World restart
- **THEN** the proof is the same core and terminal (address and creation time) and the same harness session named now by the harness's own live process record (Claude Code's `sessions/<pid>.json`, rewritten on `/clear` and `/resume`), recorded with the question as a session fingerprint and read again before and after the send is fenced
- **AND** a recycled connection generation is accepted only with this proof, and a harness without such a record never receives the answer after a restart

#### Scenario: Original session resumes after a World restart

- **WHEN** World restarts and the same harness session, for example after `claude --resume` in the same terminal, still runs where the agent asked
- **THEN** an answer saved before the restart, or given to a question open across it, is sent once and shows Sent

#### Scenario: Different or unproved session after a World restart

- **WHEN** another session or harness now runs at the captured terminal, even one reusing the original process IDs, executable name and launch command (as after `/clear`), or the runtime cannot supply the proof
- **THEN** World types nothing and shows Not sent with a plain restart reason, Copy answer and the full `herdr-world ask get <id>` command
- **AND** a later check or program change never revives that delivery

#### Scenario: Possible send before the restart

- **WHEN** World stopped while a send may have reached the terminal
- **THEN** the delivery stays uncertain and is never replayed automatically
- **AND** an owner's explicit Send again sends once only to a proven original session and to nothing else

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
- **AND** after a World restart, only a proven original harness session at the captured terminal may receive the answer

#### Scenario: Owner-only authority remains owner-only

- **WHEN** the answering actor no longer satisfies the ask policy
- **THEN** dispatch does not begin
