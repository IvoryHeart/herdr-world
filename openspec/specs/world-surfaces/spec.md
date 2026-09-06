# World surfaces

## Purpose

Keep Spaces, Office and Graph as presentations over shared runtime state and terminal ownership.
See [knowledge map](../../../docs/knowledge-map.md) for source and historical rationale.

## Requirements

### Requirement: Shared presentation
The application SHALL share qualified runtime state and terminal ownership across its
statically bundled Spaces and World surfaces. World SHALL support Office and Graph.

#### Scenario: Theme switch with an open terminal
- **WHEN** a user switches between Office and Graph
- **THEN** a live terminal window retains its session and usable resize behavior

### Requirement: Optional observations
Observability providers SHALL remain optional. The bridge SHALL mediate bounded transport
and the browser SHALL NOT receive provider credentials.

#### Scenario: Provider absent
- **WHEN** no optional provider is available
- **THEN** core topology and terminals remain available without invented agent activity

### Requirement: Accessible navigation
World SHALL expose semantic entity navigation for compact layouts and reduced-motion use.

#### Scenario: Scene navigation without pointer precision
- **WHEN** the user selects an entity through semantic navigation
- **THEN** the same qualified entity is selected as through the visual scene
