## ADDED Requirements

### Requirement: World input checks the current foreground program

All World terminal text paths on both runtimes SHALL share the foreground group leader executable-basename check, ignoring arguments and children. Shells, REPL interpreters, editors/pagers, ssh, sudo/su, database clients, tmux/screen/zellij and docker SHALL receive no text. Other basenames SHALL be admitted. Missing runtime information SHALL preserve pre-change behavior without tty or /proc inspection.

#### Scenario: Stale agent metadata after exit

- **WHEN** World prepares text while a refused executable is now the foreground group leader
- **THEN** no text is typed and the owner receives a plain Not sent reason without native error codes

#### Scenario: Agent has child processes

- **WHEN** an admitted leader has MCP helpers or shell, editor, interpreter or other children
- **THEN** those children do not block Chat, notifications, prompts or any other World text path
- **AND** a shell started inside a live harness is a documented limit

#### Scenario: Runtime provides no foreground information

- **WHEN** the runtime supplies no foreground group leader information
- **THEN** this additional check does not block input; existing authority and delivery checks remain in force

#### Scenario: Owner explicitly enters text in Terminal

- **WHEN** the owner submits/inserts a Terminal composer draft or pastes text directly in Terminal
- **THEN** existing raw-terminal connection, generation and browser authority remains in force
- **AND** World-originated agent input through the same method still uses the shared foreground leader check

#### Scenario: World addresses agent input through the pane API

- **WHEN** a peek reply, menu key or review-feedback prefill uses `pane.send_input` with `agent_input: true`
- **THEN** World consumes that marker and applies the shared foreground check immediately before native input, preserving the exact connection, generation, pane and requested submit behavior
- **AND** refusal offers Copy without a raw-input fallback or automatic retry
