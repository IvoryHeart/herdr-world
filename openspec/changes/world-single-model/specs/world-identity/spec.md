## ADDED Requirements

### Requirement: Shared entity identity target

World SHALL identify machines, workspaces, tabs, terminals, sessions and groups through shared World entities and evidence-qualified runtime bindings. Runtime generations SHALL fence operations without changing durable entity identity, and ambiguous evidence SHALL NOT merge entities.

World SHALL own profile assignment and the Town Master. Runtime terminal tokens SHALL be mirrors written by World and SHALL NOT become authoritative sources.

#### Scenario: Runtime reports an assignment token
- **WHEN** a runtime token differs from World's committed assignment or Town Master
- **THEN** World's value remains authoritative

### Requirement: One pin with independent view placement target

Town desk pins, Board card pins, Spaces tab pins, core favourites and mobile pins SHALL represent one entity pin fact. Where the runtime defines a native pin, World's pin SHALL follow and write that native definition. Board positions and Town room spots SHALL remain separate view presentation facts and MAY differ.

#### Scenario: A native pin changes
- **WHEN** the runtime's native pin changes or the user pins the entity in World
- **THEN** all World views converge on that one native-aware pin
- **AND** Board placement and Town room placement remain independently positioned
