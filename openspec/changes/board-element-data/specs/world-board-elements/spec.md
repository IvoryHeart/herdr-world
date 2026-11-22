# World Board element data

## Purpose

Provide one small built-in registry and durable source references for Board.
This capability covers data, service, API and CLI; presentation is a separate
consumer. It introduces no plugin protocol, memory service or apartment model:
a memory element may reference World's memory Library and a log element its
agent's apartment, each read and opened through its own owner.

## ADDED Requirements

### Requirement: One typed built-in element registry

World SHALL expose a closed typed registry with kind, renderer key, source and
actions for existing host, workspace, tab, pane, note, string and work kinds and
new memory, log, document and link kinds. Existing kinds SHALL retain their
current storage, source and behavior. Only the new kinds SHALL use element CRUD.

#### Scenario: Consumers discover every kind
- **WHEN** a browser or CLI requests element types
- **THEN** the same registry SHALL enumerate all eleven kinds, their existing or
  element placement seam and the new element limits

### Requirement: Durable revisioned source references

World SHALL persist new elements with IDs, kind, title, position, revision and a
typed source in the existing Board writer transaction. Writes SHALL be atomic
with existing Board operations. Stale edits/deletes, including after ID reuse,
SHALL conflict without overwriting current state. Replies and Board invalidation
SHALL follow commit. Removal SHALL delete only the reference, never its source.

#### Scenario: Two clients edit an element
- **WHEN** one edit commits before another using the same prior revision
- **THEN** the later edit SHALL return current Board state as a conflict and
  SHALL NOT publish a successful mutation

### Requirement: Real bounded project data

Memory elements SHALL read project memory files or directories, defaulting to
`MEMORY.md`, or SHALL reference one memory from World's memory Library. Log
elements SHALL read explicitly selected saved project logs or transcripts even
without the original pane. Optional descriptive agent identity SHALL NOT grant
authority. Documents SHALL hold inline text or reference project files. Links
SHALL accept credential-free HTTP(S) URLs and classify GitHub PR and issue
targets without fetching or executing embeds or forge actions.

#### Scenario: Past agent is gone
- **WHEN** its saved project transcript is read through a log element
- **THEN** World SHALL read that exact file without resolving a replacement pane

### Requirement: Library memories and apartment links

A Library memory element SHALL name its connection ID, the Library's memory
source ID and the entry path in that source, with the project it was chosen
from optional. Board SHALL NOT read it through its own project reads: its read
reply SHALL point at `world.memory.read`, and a browser SHALL read it through
the memory service on that connection's current generation, within the same
64 KiB display bound. While the Library cannot read that host, the element
SHALL be offline and SHALL NOT be read from another host. Its reader SHALL offer
to open the Library on the memory's host and project; a project-file memory
SHALL offer it when the Library can read that project.

A log MAY name the Apartments resident it belongs to. Its resident SHALL be the
named one, else the one whose harness session ID or resident ID equals the
log's agent reference, on the log's own connection only. The reader SHALL offer
to open that resident's apartment, and SHALL show the action unavailable while a
named resident no longer lives in Apartments. A resident link SHALL NOT grant
authority or change what the log reads.

#### Scenario: Memory from the Library
- **WHEN** a memory element references a Library memory and someone opens it
- **THEN** the browser SHALL read it through `world.memory.read` on the saved
  connection's current generation, and Board's own read SHALL make no host read
- **AND** Open in Library SHALL open the Library on that host and project

#### Scenario: Log of a finished agent
- **WHEN** a log names a resident, or its agent reference is a resident's session
  ID on the same connection
- **THEN** its reader SHALL offer Open apartment for that resident
- **AND** a resident of another connection with the same session ID SHALL NOT
  be offered

### Requirement: Exact runtime authority and private bounded reads

Every project read SHALL use the saved immutable connection ID and an explicitly
supplied current generation through the shared TUI/core Files seam. Offline,
retired or stale sources SHALL NOT fall back to another host or cached topology.
Results SHALL be discarded if the request, element or runtime changes in flight.
Sources SHALL stay project-relative, including symlink checks, and replies SHALL
omit absolute roots and filesystem error details. Board SHALL NOT cache source
content or send it to an agent automatically.

World SHALL bound elements to 500, inline text to 16,000 characters, source text
to 64 KiB, directory listings to 32 entries and simultaneous source reads to
eight. Existing Board/document/writer bounds SHALL continue to apply. Missing,
binary, unsupported, stale and busy sources SHALL have explicit refusal or
unavailable results. Truncation SHALL be explicit and preserve UTF-8 boundaries.

#### Scenario: Reconnection during a source read
- **WHEN** a named generation retires before its read completes
- **THEN** the result SHALL be refused without publishing the retired content

#### Scenario: Memory directory child escapes the project
- **WHEN** a requested path traverses upward or resolves outside through a link
- **THEN** World SHALL refuse the read without revealing external content

### Requirement: One transport-neutral owner

Authenticated browser RPC and local CLI SHALL expose types, list, put, delete
and read through one service. The API SHALL document payloads, response examples,
source mappings, conflicts and limits for the Board presentation consumer.

#### Scenario: CLI creates and browser reads
- **WHEN** a CLI document creation is acknowledged
- **THEN** browser list/read SHALL observe the same committed element and text

#### Scenario: CLI discovers a project source generation
- **WHEN** a caller runs `herdr-world ls --json`
- **THEN** each connection row SHALL include its snapshot connection's current runtime `generation`, connection ID, current status and workspace selectors
- **AND** a caller SHALL be able to use a `current: true` row's selectors to create and read a project-backed element without guessing the generation
- **AND** a generation change SHALL still require refreshing the listing rather than falling back to another runtime
