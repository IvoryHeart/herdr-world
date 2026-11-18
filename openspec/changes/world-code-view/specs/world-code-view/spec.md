## Purpose

Present qualified World projects, changes and existing agent terminals in a native
Code view, preserving the same entities, origin and authority as other World views.

## ADDED Requirements

### Requirement: Room projects in the same World

Code SHALL be a projection of existing hosts, rooms, agents and terminals in the
common World shell. Opening a room in Code SHALL resolve its project on its exact
connection and runtime generation. Project and agent-checkout selection SHALL be
explicit and preserve separate qualified file contexts. The initial capability
SHALL provide reading/review and terminal access without filesystem writes.

#### Scenario: Open a room project
- **WHEN** a user opens an available room in Code
- **THEN** its admitted project opens with owning host, room, checkout and branch visible
- **AND** opening the view neither moves an agent nor starts a process

#### Scenario: Agent has a linked worktree
- **WHEN** a user explicitly selects that agent's checkout
- **THEN** files and changes use the verified linked checkout on its original connection
- **AND** selecting only the agent's terminal does not implicitly switch the file checkout

#### Scenario: No project can be admitted
- **WHEN** the room has no known root, ambiguous roots or an unavailable checkout
- **THEN** Code explains the missing context or offers explicit known choices
- **AND** it does not guess a cwd or substitute another room or host

### Requirement: Bounded qualified file and change reads

Each Code project resource SHALL bind immutable connection ID, runtime generation,
room/resource generation and validated root/checkout identity, plus agent/session
identity where applicable. Reads and diffs SHALL respect current provider limits
and project-root confinement. Dispatch and result publication SHALL reject retired
bindings; access SHALL NOT silently broaden to arbitrary filesystem scope.

#### Scenario: Colliding room names on different hosts
- **WHEN** two connections expose projects or terminals with the same display name
- **THEN** Code reads only through the explicitly admitted connection and root

#### Scenario: Traversal or symlink escape
- **WHEN** a project request resolves outside the admitted root
- **THEN** the service refuses it without retrying under a broader file scope

#### Scenario: Late reply or changed root
- **WHEN** a selection retires or its checkout/generation changes while a read is pending
- **THEN** the old reply cannot populate the new selection or grant it authority

#### Scenario: Unsupported file or provider
- **WHEN** a file exceeds current preview limits or its provider cannot serve that operation
- **THEN** Code shows the specific read-only/unsupported state and retains other supported operations

### Requirement: Existing terminals retain ownership and lifecycle

Code SHALL display existing Herdr TUI or herdr-core terminals through their World
consumer and input-admission rules. Targets SHALL remain connection-, generation-
and occurrence-qualified. Only the admitted focused terminal SHALL receive input.
Closing, hiding or switching Code's terminal consumer SHALL release its input
authority without terminating the underlying agent or replaying buffered keys.

#### Scenario: Observe and type
- **WHEN** a user opens an agent terminal beside source
- **THEN** it starts observing and accepts input only through explicit current control admission
- **AND** typing in source, search or review fields sends no terminal input

#### Scenario: Another surface already owns a terminal
- **WHEN** Code requests the same target as an Inspector or Spaces consumer
- **THEN** the existing ownership transfer rules prevent duplicate input ownership

#### Scenario: Terminal is replaced or view is hidden
- **WHEN** the target occurrence/generation changes or Code stops displaying its consumer
- **THEN** control and unsent keys are released and no replacement is attached by display name
- **AND** the existing runtime process is not killed by the view transition

### Requirement: One origin and existing authentication

The browser SHALL obtain Code assets, project reads and terminal streams only
through the World origin and its existing authenticated admission. The service
SHALL own local/SSH file access and runtime transports. Code SHALL NOT add a remote
browser bridge, IDE listener, external account requirement or executable project
content on open. File and terminal content SHALL NOT enter new persistent browser caches.

#### Scenario: SSH project opened on a phone
- **WHEN** a logged-in user opens an SSH room in Code
- **THEN** the service uses its saved OpenSSH policy and the phone contacts only World
- **AND** no SSH secrets or remote IDE credentials are sent to the browser

#### Scenario: Authentication expires
- **WHEN** the World session ends or request admission is lost
- **THEN** consumers stop and in-memory project/terminal content is cleared without automatic input replay

### Requirement: Changes and PRs retain evidence and freshness

Code SHALL scope file changes to the selected checkout and associate PRs only using
validated repository/branch/work evidence. It SHALL distinguish agent activity
from proven authorship and expose stale or unavailable provider data. PR navigation
SHALL use validated existing provider URLs. This capability SHALL NOT add Git
mutation or PR approval/merge operations.

#### Scenario: Agent change and reported PR
- **WHEN** the selected checkout changes and a validated linked PR is available
- **THEN** Code offers that checkout's comparison and the PR's branch/check/review context
- **AND** a terminal's activity alone does not attribute every changed line to that agent

#### Scenario: Missing or stale PR evidence
- **WHEN** PR association, credentials or fresh checks are unavailable
- **THEN** Code states that absence or staleness without inventing a PR or passing checks

### Requirement: Phone navigation and disconnection preserve context

Compact Code SHALL expose named keyboard/assistive controls and touch targets of at
least 44 by 44 CSS pixels for file, code, agent and review navigation. Panel changes
SHALL retain their qualified selection. Disconnected cached content SHALL be visibly
stale and non-actionable; fresh actions SHALL require exact target revalidation.

#### Scenario: Navigate on a phone
- **WHEN** a user moves from a file to an agent terminal and then a diff
- **THEN** the same project's context remains visible and the previous file selection is retained

#### Scenario: Host disconnects and reconnects
- **WHEN** the selected host disconnects and later becomes reachable
- **THEN** cached content is marked stale and input is refused until its exact target is revalidated
- **AND** reconnection does not automatically send keys or restore terminal control
