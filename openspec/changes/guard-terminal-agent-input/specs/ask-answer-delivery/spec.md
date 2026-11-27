## ADDED Requirements

### Requirement: Only the original agent foreground receives an answer

World SHALL type an ask's question or answer only while fresh native foreground evidence identifies the original asking harness and session at its captured terminal, connection and generation. A shell, editor, different harness, replacement agent process or unknown foreground SHALL be treated as not attached, even if an old agent/session report remains. Historical recipients lacking original foreground evidence SHALL remain retrieval-only.

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
