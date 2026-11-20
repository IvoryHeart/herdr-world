# World memory

## Purpose
Inspect and explicitly manage harness memory on its owning connection without
persisting its contents in World or inventing proof that a harness loaded it.

## Requirements

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

### Requirement: Library in the browser
World SHALL present memory as one Library dialog, opened from Town's library
building, the town center ring, Board's hub and an agent's settings, with the
same components for TUI and core connections. It SHALL show readers (a host, a
project or an agent, with an agent's candidate load), shelves per source with
size, age, staleness and sharing, and one open entry read fresh from its host.
Contents SHALL live only in the dialog; only catalog metadata may be cached, for
counts. Every call SHALL name the Library's chosen connection and generation.
A missing, non-refused source SHALL offer explicit creation of its first entry.

#### Scenario: Fresh project memory
- **WHEN** a project's memory folder does not exist yet
- **THEN** its shelf offers to add the first note, and creating it makes the folder

### Requirement: Library keeps its host and reader
The Library's chosen host SHALL be explicit (the opener's or the user's pick). If its
connection disappears the Library SHALL show that host's memory as unavailable
and SHALL NOT substitute another host or carry its reader over to one, even
when the other host uses the same native agent ID. A host, generation or reader change SHALL retire catalog, search
and entry replies still in flight.

#### Scenario: Named host disconnects
- **WHEN** the Library shows host A's agent and host A disconnects while host B, with the same agent ID, stays
- **THEN** the Library says host A's memory is unavailable, does not read host B, and opens host B only on an explicit choice with all readers

#### Scenario: Search overtaken
- **WHEN** a search is under way and the reader or host changes
- **THEN** its matches never show and Search is available again

### Requirement: Library saves reconcile uncertain outcomes
Library saves SHALL use the revision the draft was started from. After an uncertain
outcome the Library SHALL read the entry again and adopt the new revision only if
the host holds exactly the draft; otherwise the draft SHALL stay on its original
revision, so a further save refuses if anyone else changed the file.

#### Scenario: Uncertain save over an external edit
- **WHEN** a save's outcome is uncertain and another editor changed the file
- **THEN** the draft stays, a second save sends the original revision and refuses, and Load latest shows the external text
