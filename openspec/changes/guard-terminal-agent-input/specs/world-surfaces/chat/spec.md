## ADDED Requirements

### Requirement: Agent input requires a current agent foreground

World agent text input SHALL require fresh native foreground evidence of the addressed harness and session at send time, through shared runtime authority across views. Unknown or changed foregrounds SHALL refuse input without replay; stale reports and transcripts alone SHALL NOT authorize typing. Explicit raw terminal interaction retains its terminal authority.

#### Scenario: Stale agent metadata after exit

- **WHEN** Chat, a notification reply or a prompt action addresses an agent whose terminal foreground is now a shell, editor, another harness or unknown
- **THEN** no agent input is typed and the caller receives a not-attached refusal, including Chat text, notification replies, prompts and prompt/menu text

#### Scenario: Session changes during transport preparation

- **WHEN** the addressed agent/session changes while World prepares its foreground check
- **THEN** no input reaches the replacement and the action is not replayed

#### Scenario: Owner explicitly enters text in Terminal

- **WHEN** the owner submits or inserts a Terminal composer draft, pastes text or pre-fills review feedback into a shell or a pane whose foreground is no longer its reported agent
- **THEN** the raw terminal request retains its existing connection, generation and browser authority without requiring an attached agent
- **AND** World-originated agent sends through the same pane input method still require the original agent foreground

#### Scenario: Script interpreters and wrapper scripts

- **WHEN** a foreground leader is an interpreter
- **THEN** admission requires its script argument to identify the harness, and interactive REPL flags or later arguments cannot authorize input
- **AND** a wrapper leader with a harness child refuses with the remedy: started through a wrapper script; use `exec` in the script

#### Scenario: Clear refusal and transient unavailability

- **WHEN** foreground admission refuses Board notes, launch briefs or Chat before typing
- **THEN** the owner sees Not sent and a plain reason without native error codes or possible-send wording
- **AND** a failed read is unavailable rather than a confirmed session change, so saved answers can wait and retry
