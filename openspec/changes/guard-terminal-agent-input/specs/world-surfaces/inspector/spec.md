## ADDED Requirements

### Requirement: Review prefill checks the foreground program

Review-feedback prefill SHALL use World's shared foreground-program check on its selected qualified pane, including text compiled from file, diff and terminal quotes. A pane's agent label SHALL NOT authorize input by itself. Prefill SHALL NOT append a submit key.

#### Scenario: A refused program replaces the review agent

- **WHEN** the owner chooses prefill while a shell, REPL, editor or another refused program leads that pane's foreground group
- **THEN** no feedback is typed, Review feedback not sent offers Copy feedback, and the review draft remains intact
- **AND** Copy feedback copies the original compiled message without input or retry

#### Scenario: The selected agent admits prefill

- **WHEN** the foreground check admits the selected qualified pane
- **THEN** feedback is prefilled without a submit key and only unchanged delivered comments are removed
- **AND** concurrent edits and drafts whose workspace or connection was left remain retained
