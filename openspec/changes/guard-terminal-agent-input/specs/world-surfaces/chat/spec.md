## ADDED Requirements

### Requirement: World input checks the current foreground program

Every World-originated terminal text path SHALL share the current foreground check on both runtimes, including Chat, notifications, prompts, menu text, Board notes and launch briefs. Shells by basename regardless of arguments, multiplexers, launchers, REPLs, editors/pagers, ssh, privilege and database clients SHALL receive no text. Tool children under an admitted leader SHALL mean temporarily busy. Other programs SHALL be admitted without recognizing a harness or original session.

#### Scenario: Stale agent metadata after exit

- **WHEN** World prepares text while a refused program now reads the terminal
- **THEN** no text is typed and the owner receives a plain Not sent reason without native error codes

#### Scenario: Resumed agent, npm script or wrapper

- **WHEN** an arbitrary agent, resumed/restarted agent or non-shell script launcher runs in the foreground
- **THEN** input is allowed unless a refused program reads the terminal, including a foreground child
- **AND** no original-session witness or foreground PID hash is required

#### Scenario: Temporary read failure

- **WHEN** World cannot read the current foreground or reads an empty command line
- **THEN** it types nothing and says to try again shortly, keeping saved answers pending for a fresh check

#### Scenario: Owner explicitly enters text in Terminal

- **WHEN** the owner submits/inserts a Terminal composer draft, pastes text or pre-fills review feedback
- **THEN** existing raw-terminal connection, generation and browser authority remains in force
- **AND** World-originated agent input through the same method still uses the shared foreground program check

#### Scenario: Tool child is temporarily busy

- **WHEN** an admitted leader has a foreground ssh, python (including scripts and stdin), psql or sudo child
- **THEN** World types nothing and says the terminal is busy and to try again shortly, without saying the agent has gone
- **AND** saved answers remain pending for a fresh check

### Requirement: Input admission excludes pipe-connected helpers

Only processes in the terminal's foreground process group whose stdin is that terminal's PTY SHALL count. Pipe-connected helpers SHALL NOT block input. Missing reader evidence SHALL leave input temporarily unavailable.

#### Scenario: Agent uses stdio MCP or a language server

- **WHEN** an admitted foreground agent has helpers whose stdin is a pipe
- **THEN** those helpers do not block Chat, notifications, prompts or any other World text path
- **AND** a PTY-reading child still receives the shared refusal or busy check
