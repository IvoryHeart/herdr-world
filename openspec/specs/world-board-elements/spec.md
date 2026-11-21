# World Board element data

## Purpose

Provide one small built-in registry and durable source references for Board.
This capability covers data, service, API and CLI; presentation is a separate
consumer. It introduces no plugin protocol, memory service or apartment model.

## Requirements

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
`MEMORY.md`. Log elements SHALL read explicitly selected saved project logs or
transcripts even without the original pane. Optional descriptive agent identity
SHALL NOT grant authority. Documents SHALL hold inline text or reference project
files. Links SHALL accept credential-free HTTP(S) URLs and classify GitHub PR and
issue targets without fetching or executing embeds or forge actions.

#### Scenario: Past agent is gone
- **WHEN** its saved project transcript is read through a log element
- **THEN** World SHALL read that exact file without resolving a replacement pane

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
