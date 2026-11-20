## ADDED Requirements

### Requirement: One bounded memory model
World SHALL expose sources, Markdown entries, supported harness adapters,
project/agent associations, sizes, modification times, age hints and load evidence
through one model for TUI and core connections. Missing sources SHALL be visible;
unsupported harnesses and incomplete discovery SHALL be explicit.

#### Scenario: Shared project memory
- **WHEN** two live agents have the same project memory directory
- **THEN** the source has one identity with both agent associations and its project associations

#### Scenario: Bounded observation
- **WHEN** discovery or search exceeds a count, byte or depth limit
- **THEN** it stops and marks the result truncated without mutating any files

### Requirement: Files belong to their connection
Every call SHALL require an immutable connection ID and observed generation and
SHALL read fresh topology and files only through that connection's host access.
Retired, disconnected, unknown or unsupported hosts SHALL refuse without fallback.
World SHALL NOT persist memory contents, execute them or follow symlinks.

#### Scenario: Generation changes
- **WHEN** a request uses a retired generation or the generation retires in flight
- **THEN** the request refuses and cannot return a successful read or mutation receipt

### Requirement: Explicit revision-checked management
Browse, literal search and reads SHALL be read-only. Create/update SHALL require
an explicit user action. Update/delete SHALL require a matching revision; create
SHALL require absence. Delete SHALL additionally require confirmation. Mutations
SHALL affect only regular Markdown files in a discovered source, preserve existing
permissions and use atomic file replacement. Conflicts SHALL leave current data
unchanged. An uncertain transport outcome SHALL NOT be retried automatically.

#### Scenario: Concurrent edit
- **WHEN** an external editor changes an entry after World read it
- **THEN** update or deletion with the old revision refuses and preserves the external edit

#### Scenario: Delete without confirmation
- **WHEN** a caller deletes without confirmed=true
- **THEN** admission or the service refuses before filesystem mutation

### Requirement: Shared CLI and API contract
World SHALL expose list/search/read/create/update/delete through authenticated
local CLI and same-origin RPC using the same service and limits. API documentation
SHALL describe each call, data, examples and refusal handling for downstream UI.

#### Scenario: CLI acceptance
- **WHEN** a user explicitly creates, searches, reads, updates and confirms deleting a memory
- **THEN** the owning host's file changes accordingly and stale revisions refuse
