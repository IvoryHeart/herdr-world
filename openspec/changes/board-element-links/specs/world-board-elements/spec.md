## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Library memories and apartment links

Board introduces no memory service or apartment model of its own: a memory
element may reference World's memory Library and a log element its agent's
apartment, each read and opened through its own owner.

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

Board's forms and readers SHALL name these plainly, as Memory and past
sessions; Town's names for them (Library, Apartments) SHALL stay in Town.

#### Scenario: Memory from the Library
- **WHEN** a memory element references a Library memory and someone opens it
- **THEN** the browser SHALL read it through `world.memory.read` on the saved
  connection's current generation, and Board's own read SHALL make no host read
- **AND** Open in Memory SHALL open the Library on that host and project

#### Scenario: Log of a finished agent
- **WHEN** a log names a resident, or its agent reference is a resident's session
  ID on the same connection
- **THEN** its reader SHALL offer Open past session for that resident
- **AND** a resident of another connection with the same session ID SHALL NOT
  be offered
