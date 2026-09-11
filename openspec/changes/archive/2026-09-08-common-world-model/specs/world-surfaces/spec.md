## MODIFIED Requirements

### Requirement: Shared presentation
The application SHALL derive one host-qualified World hierarchy from configured host profiles and
admitted runtime state, and SHALL share that hierarchy, qualified target identity, and terminal
ownership across its statically bundled Spaces and World surfaces. World SHALL support Office and
Graph.

Each configured host SHALL be a root entity. Each observed Herdr space SHALL be a direct child of
its exact owning host. Each observed pane/terminal pair SHALL be represented exactly once as either
an agent or terminal child of its owning space. Agent and terminal entities SHALL be siblings in
the current hierarchy and SHALL retain stable terminal-backed identity when their classification,
label, status, focus, or summary changes.

Graph SHALL present hosts as its primary nodes and preserve the shared containment relationships in
its visual and semantic views. Themes MAY omit, aggregate, or relocate entities for presentation,
but SHALL NOT change their authoritative ancestry. A future child-agent relationship SHALL be
added only when an admitted authoritative source identifies the parent; the client MUST NOT infer
parentage from labels, paths, processes, or timing.

#### Scenario: Theme switch with an open terminal
- **WHEN** a user switches between Office and Graph
- **THEN** both themes interpret the same qualified host, space, agent, and terminal entities and a
  live terminal window retains its session and usable resize behavior

#### Scenario: Two hosts contain equal space and terminal identifiers
- **WHEN** two configured hosts report equal native space or terminal identifiers
- **THEN** the shared hierarchy contains distinct host-qualified subtrees and Graph connects every
  space, agent, and terminal only to its exact owning host

#### Scenario: Host has no admitted snapshot
- **WHEN** a configured host is disabled, connecting, incompatible, or offline without cached
  topology
- **THEN** the shared hierarchy retains the host with its connection state and no invented child
  entities

#### Scenario: Terminal classification changes
- **WHEN** a pane changes between an empty terminal and a detected agent without changing its
  qualified terminal identity
- **THEN** its shared entity retains its identity and space ancestry while its terminal or agent
  interpretation updates

#### Scenario: Theme relocates an agent visually
- **WHEN** a theme places an agent in a status-specific area such as Office reception or the agent
  bar
- **THEN** the shared hierarchy still records that agent beneath its authoritative owning space
