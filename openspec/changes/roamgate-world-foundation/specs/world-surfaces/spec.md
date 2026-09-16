## ADDED Requirements

### Requirement: Native World shell
The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Spaces, Office, Tree and Graph. These views SHALL share the
same connection identities, admitted topology and terminal ownership; World SHALL not embed or
launch a separately branded Roamgate application.

#### Scenario: Install World only
- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and World visual views are available without installing Roamgate or another web bridge

#### Scenario: Move between workspace and World views
- **WHEN** a user opens a terminal in the workspace view and switches to Office, Tree or Graph
- **THEN** the same connection-qualified terminal remains available without a competing attachment
  or a second service

#### Scenario: Use a host-specific Inspector from an aggregate World view
- **WHEN** a user selects an entity from a host-qualified World hierarchy and opens Files, Changes
  or Agent History
- **THEN** the Inspector uses only that entity's owning connection and checkout context

