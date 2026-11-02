# Workspace assistant

## Purpose

Provide optional service-owned Ranger conversations and scheduled work while
preserving World connection ownership and explicit workspace permissions.

## Requirements

### Requirement: Explicit workspace and model permission
World SHALL initially allow no workspaces. Ranger SHALL read only explicitly
allowed workspaces using a configured provider and model. Explicit High-mode
all-workspace consent MAY authorize current and future workspaces; existing manual
grants SHALL be preserved, legacy automatic approval SHALL NOT imply that consent,
and truncated inventories SHALL prevent broader admission. Provider credentials
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

#### Scenario: Confirmed task action awaiting dispatch
- **WHEN** a confirmed task action awaits target checks or RPC dispatch and its
  workspace permission is revoked, its task is stopped, or its service is disposed
- **THEN** Ranger sends no workspace mutation

### Requirement: Durable task identity
Scheduled recovery SHALL verify endpoint fingerprint, Herdr server identity and
workspace identity before capturing a fresh runtime. Replaced identities SHALL
prevent automatic recovery. Notifications SHALL retain session-bound delivery
and identify their Ranger task without retargeting a terminal.

#### Scenario: Endpoint or workspace replacement
- **WHEN** a saved task's endpoint or workspace identity changes
- **THEN** the task cannot resume against the replacement identity

### Requirement: Structured mention identity
Workspace and agent mentions SHALL bind canonical connection, workspace and runtime
identities. Agent mentions SHALL additionally bind the concrete terminal and agent
session. Reads and saved-task edits SHALL reject replaced identities before using
or rebinding the referenced data. Mentioning an agent SHALL NOT send it a prompt.

#### Scenario: Agent replacement after selection
- **WHEN** a mentioned agent's terminal or session changes before evidence is read
- **THEN** Ranger rejects the stale reference instead of reading its replacement

### Requirement: Guarded close and task management
Close previews SHALL pin affected pane layouts and occupants, follow the current
confirmation policy, and reject unsupported implicit group closes. Task-management
previews SHALL retain task revisions, original scope and recovery targets and expire
after ten minutes or service restart. Manual task edits SHALL downgrade future runs
to manual approval, and automatic edits SHALL NOT elevate a previously manual task.
Task deletion SHALL require prior cancellation and drain its private run resources.

#### Scenario: Task changes while management preview is pending
- **WHEN** a task revision changes after a management preview was prepared
- **THEN** Ranger rejects that preview and requires a refreshed proposal

#### Scenario: Pane occupant changes before close
- **WHEN** a close preview's captured pane layout or occupant changes before dispatch
- **THEN** Ranger rejects the close instead of acting on the replacement

### Requirement: Ordered messages during a running turn
World SHALL admit at most eight pending Ranger messages, deduplicate request IDs,
and process steering, removal and follow-up admission in queue order. A steer
SHALL remain within the running turn's captured scope and runtime generation;
unavailable or wider steering SHALL become a follow-up. Follow-ups SHALL capture omitted scopes at enqueue time and retain
their selected runtime generations and model/effort selection through persistence and SHALL NOT recapture
a replacement runtime automatically. Stop, failure, restart or chat switching
SHALL hold waiting messages until explicit user continuation. Pending action or
task previews SHALL block automatic follow-up admission.

#### Scenario: Runtime replaced while a question waits
- **WHEN** the runtime selected by a queued question is replaced before admission
- **THEN** the queue is held with a scope error and the replacement receives no turn

#### Scenario: Steer targets a different runtime generation
- **WHEN** a steering message names a generation other than the running turn's
- **THEN** it waits as a follow-up and does not enter that running turn

#### Scenario: Stop with waiting questions
- **WHEN** the user stops Ranger with pending questions
- **THEN** waiting questions remain held across restart until explicit continuation

#### Scenario: Model changes while a question waits
- **WHEN** a queued question's provider, model, credential source or effort differs from the current selection
- **THEN** admission is held until the original selection is restored or the user resends the message

#### Scenario: Stale browser sends while Ranger is busy
- **WHEN** a busy send carries an outdated expected model selection
- **THEN** it is rejected before entering the queue

#### Scenario: Chat changes during queued scope capture

- **WHEN** a busy send is awaiting scope discovery or capture and its originating
  chat is left, including leaving and returning before capture completes
- **THEN** admission is rejected without persisting or sending that message

#### Scenario: Concurrent retries during queued scope capture

- **WHEN** two busy sends with the same request ID finish asynchronous scope capture
- **THEN** at most one queue entry is persisted or admitted as a turn, and published
  and persisted queues retain unique IDs

### Requirement: Qualified engine and navigation behavior

Ranger MAY use the service account's Claude Code CLI or the configured Pi-backed
provider. Both engines SHALL retain the same captured workspace permissions and
confirmation policy. Engine checkpoints SHALL NOT be resumed by another engine.
An interrupted Claude turn SHALL fail closed and retain queued-message controls.

A show request SHALL carry its originating question and captured connection/runtime
owner. Only the asking browser SHALL follow it through shared Inspector admission.
A service-instance change SHALL retire earlier navigation requests. Stale or
unavailable targets SHALL report refusal without selecting another runtime.
Scheduled runs SHALL NOT publish browser navigation requests.

#### Scenario: Another browser receives a show reply

- **WHEN** a browser observes a reply to a question sent by another browser
- **THEN** its Inspector and selection SHALL remain unchanged

### Requirement: Explicit dynamic task membership

An explicitly selected all-workspace task MAY include newly authorized workspaces
at each new run admission. It SHALL require all-workspace permission, then capture
and validate that run's current owners. Fixed-scope tasks SHALL retain their saved
identity checks. Membership selection SHALL NOT authorize a stale active run to
retarget a replacement runtime.

#### Scenario: Refresh membership for a new run only

- **WHEN** a new run of an explicit all-workspace task is admitted with the required
  all-workspace permission
- **THEN** that run SHALL capture the currently authorized workspace owners
- **AND** an earlier admitted run SHALL NOT retarget a replacement runtime
