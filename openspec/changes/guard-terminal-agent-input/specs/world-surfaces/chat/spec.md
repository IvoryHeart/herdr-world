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
