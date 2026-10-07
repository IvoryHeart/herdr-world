# Workspace assistant

## Purpose

Provide optional service-owned Ranger conversations and scheduled work while
preserving World connection ownership and explicit workspace permissions.

## Requirements

### Requirement: Explicit workspace and model permission
World SHALL initially allow no workspaces. Ranger SHALL read only explicitly
allowed workspaces using a configured provider and model. Provider credentials
and durable state SHALL remain in private service-owned storage.

#### Scenario: Unconfigured assistant
- **WHEN** no model or authorized workspace is configured
- **THEN** Ranger refuses a workspace question without reading workspace context

### Requirement: Captured interactive runtime
Interactive sends and new task admissions SHALL carry their selected catalogue
generation. World SHALL reject a stale generation before reading or acting on
its replacement. Confirmed actions SHALL retain their captured connection,
runtime generation and workspace identity.

#### Scenario: Reconnect between selection and admission
- **WHEN** the selected runtime is replaced before a question is admitted
- **THEN** Ranger rejects it and requires a refreshed workspace selection

### Requirement: Explicit action and scheduling policy
Manual confirmation SHALL be the default for workspace writes and proposed
schedules. Automatic supported actions MAY occur only under an explicitly enabled
high-permission policy, rechecked before execution. Tasks SHALL run in separate
conversations and expose stop, disable and notification controls.

#### Scenario: Permission revocation
- **WHEN** workspace or automatic-action permission is removed during a turn
- **THEN** Ranger refuses subsequent reads or writes requiring that permission

### Requirement: Durable task identity
Scheduled recovery SHALL verify endpoint fingerprint, Herdr server identity and
workspace identity before capturing a fresh runtime. Replaced identities SHALL
prevent automatic recovery. Notifications SHALL retain session-bound delivery
and identify their Ranger task without retargeting a terminal.

#### Scenario: Endpoint or workspace replacement
- **WHEN** a saved task's endpoint or workspace identity changes
- **THEN** the task cannot resume against the replacement identity
