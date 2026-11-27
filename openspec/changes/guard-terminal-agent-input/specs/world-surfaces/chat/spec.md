## ADDED Requirements

### Requirement: World input checks the current foreground program

Every World-originated terminal text path SHALL use one shared check of the current foreground program immediately before typing. Shells, interactive REPLs, editors/pagers, ssh, sudo/su and database clients, including foreground children, SHALL receive no text. Other programs SHALL be admitted without recognizing a harness or original session. This includes Chat, notification replies, prompts/menu text, Board notes and launch briefs on both runtimes.

#### Scenario: Stale agent metadata after exit

- **WHEN** World prepares text while a refused program now reads the terminal
- **THEN** no text is typed and the owner receives a plain Not sent reason without native error codes

#### Scenario: Resumed agent, npm script or wrapper

- **WHEN** an arbitrary agent, resumed/restarted agent or noninteractive script launcher runs in the foreground
- **THEN** input is allowed unless a refused program reads the terminal, including a foreground child
- **AND** no original-session witness or foreground PID hash is required

#### Scenario: Temporary read failure

- **WHEN** World cannot read the current foreground
- **THEN** it types nothing and says to try again shortly, keeping saved answers pending for a fresh check

#### Scenario: Owner explicitly enters text in Terminal

- **WHEN** the owner submits/inserts a Terminal composer draft, pastes text or pre-fills review feedback
- **THEN** existing raw-terminal connection, generation and browser authority remains in force
- **AND** World-originated agent input through the same method still uses the shared foreground program check
