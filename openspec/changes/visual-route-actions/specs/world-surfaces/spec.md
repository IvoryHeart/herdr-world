## ADDED Requirements

### Requirement: Use Actions from an explicit visual target

Office, Tree and Graph SHALL expose a common, keyboard- and pointer-accessible Actions entry point for the explicitly selected World entity. The first release SHALL offer only existing, applicable Inspector resource actions—Terminal, Files, Changes and Agent History—and an explicit transition to that entity in Spaces. Action availability SHALL come from the entity's current capabilities. The entry point SHALL identify the target host, space and pane as applicable. It SHALL NOT use hidden Spaces focus, create a second terminal owner or introduce agent task or lifecycle commands.

#### Scenario: Open Actions for a selected agent

- **WHEN** a user selects an actionable agent in any visual view and opens Actions
- **THEN** the menu identifies that agent and offers only its admitted resource actions plus Go to Spaces

#### Scenario: No actionable selection exists

- **WHEN** Actions opens without an actionable space or pane selected
- **THEN** it explains that an entity must be selected and does not offer a command against the last focused Spaces pane

#### Scenario: Choose an Inspector resource

- **WHEN** a user chooses Terminal, Files, Changes or History from Actions
- **THEN** the shared Inspector opens or focuses that resource for the exact selected entity, preserving the current view and terminal ownership

#### Scenario: Go to Spaces

- **WHEN** a user chooses Go to Spaces for a current space or pane
- **THEN** Spaces becomes visible at that qualified target through the existing selected-connection lifecycle, without creating a pane or switching hosts

### Requirement: Revalidate visual actions at dispatch

An Actions target SHALL capture connection ID, runtime generation and native entity identity at menu admission. Before dispatch, World SHALL verify the same selected host, generation and live entity still apply. Selection changes SHALL dismiss or replace the old menu. A stale, missing or unsupported target SHALL fail without acting on a colliding identifier, a newly selected host or hidden Spaces state.

#### Scenario: Host switches while Actions is open

- **WHEN** the selected connection changes before the user chooses an action
- **THEN** the old menu closes or rejects the action and cannot operate on either host through the stale target

#### Scenario: Runtime or entity changes while Actions is open

- **WHEN** the runtime generation advances or the selected pane disappears before dispatch
- **THEN** World reports that the target is no longer available and performs no action

#### Scenario: Selected entity changes while Actions is open

- **WHEN** the user selects another entity before choosing an item
- **THEN** the previous target's menu is dismissed or replaced and no item silently follows the new selection
