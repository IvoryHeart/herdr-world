## ADDED Requirements

### Requirement: Chat-created workspace scope

A successfully created workspace MAY join its creating Ranger chat and active turn.
Existing captured leases and mention guards SHALL be retained when extending the
turn; another runtime generation SHALL NOT be substituted. This chat-local grant
SHALL NOT widen global grants or authorize unrelated scheduled work. A complete
inventory that no longer contains the workspace SHALL retire the chat-local grant.

#### Scenario: Creation continues in the same turn

- **WHEN** Ranger creates a workspace using an approved action
- **THEN** it MAY read that workspace in the creating chat without another global grant
- **AND** extending the turn SHALL reject a replaced connection generation

### Requirement: Fresh fixed-task membership after restart

A fresh fixed-scope task run MAY omit original workspaces that have closed and SHALL
record why they were skipped. A still-open workspace whose permission was removed
SHALL cause refusal. After a Herdr restart, a fresh run SHALL recheck each original
endpoint and workspace identity; an interrupted run SHALL NOT resume on the new server.

#### Scenario: Original ID now identifies another workspace

- **WHEN** a fresh run rechecks an original workspace after Herdr restarts
- **THEN** a different workspace at that ID SHALL be skipped with a notice
- **AND** no replacement workspace SHALL inherit the original authorization

## MODIFIED Requirements

### Requirement: Explicit workspace and model permission
World SHALL initially allow no workspaces. Ranger SHALL read only explicitly
allowed workspaces, or workspaces created through an approved action in that chat,
using a configured provider and model. Explicit High-mode
all-workspace consent MAY authorize current and future workspaces; existing manual
grants SHALL be preserved, legacy automatic approval SHALL NOT imply that consent,
and truncated inventories SHALL prevent broader admission. Provider credentials
and durable state SHALL remain in private service-owned storage.

#### Scenario: Unconfigured assistant
- **WHEN** no model or authorized workspace is configured
- **THEN** Ranger refuses a workspace question without reading workspace context
