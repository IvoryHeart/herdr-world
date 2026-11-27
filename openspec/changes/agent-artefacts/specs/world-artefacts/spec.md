# World artefacts

## Purpose

Show what agents make (reports, documents, pages, images, published links) as
World things tied to the agent and room that made them, kept in the Library.

## ADDED Requirements

### Requirement: One derived artefact record

World SHALL derive each agent's artefacts on the server from that agent's bound
harness transcript and carry them on the per-agent desk read, for Herdr and
herdr-core agents alike.

#### Scenario: Artefact projection and ownership

- **WHEN** World projects an agent's artefacts
- **THEN** Each record SHALL hold a stable ID for its place on
  its connection, title, kind (`document`, `report`, `page`, `image` or `file`),
  where it lives (an absolute file path on the agent's host or an HTTP(S) link),
  when it was made, its evidence, whether the file still exists and its maker:
  the immutable connection ID, pane ID, harness, the agent session Herdr reported
  (as a fingerprint, or none) and the room (workspace) it was made in. The room
  SHALL be the one World first saw that maker's transcript in, kept while the
  service runs even if the agent moves rooms, and never another agent's. Records
  SHALL be newest first, one per place, at most 24 per session. Views SHALL
  display these records only and SHALL NOT derive or keep their own maker, room,
  record or list.

#### Scenario: The same file is written twice
- **WHEN** an agent writes the same report path twice
- **THEN** World SHALL show one record dated by the later write

#### Scenario: The same path on two hosts
- **WHEN** agents on two connections each write `/work/report.md`
- **THEN** World SHALL give the two records different IDs

#### Scenario: The agent moves rooms
- **WHEN** an agent that made a report moves to another workspace
- **THEN** the record SHALL keep the room it was made in

#### Scenario: Another agent recreates the same path
- **WHEN** a report is deleted and an agent in another room writes the same path
- **THEN** that agent's record SHALL name its own pane and room

#### Scenario: A herdr-core agent makes a report
- **WHEN** a Claude Code agent run by herdr-core writes a report
- **THEN** its Desk card SHALL count it, read through its own core connection

#### Scenario: A session is only guessed
- **WHEN** the agent's transcript binding is a guess
- **THEN** World SHALL show no artefacts for it

### Requirement: Discovery from harness records

For Claude Code and Codex, World SHALL treat a file-creating tool call naming a
path, and a patch that adds a file, as reliable evidence, resolving relative
paths against the working folder the transcript recorded for that call (a
shell call's own `workdir` first), never against a later folder.

#### Scenario: Harness discovery evidence

- **WHEN** World discovers artefacts from harness records
- **THEN** A call the
  transcript does not place SHALL resolve only when the session used one folder.
  Links printed by publishing commands SHALL be reliable published links. Links
  the agent wrote in its reply SHALL be marked as a guess and shown as one.
  Edits of existing files, code and configuration files, harness bookkeeping and
  links carrying credentials SHALL NOT be artefacts. World SHALL NOT open, type
  into or otherwise act on the agent.

#### Scenario: Codex adds a Markdown plan
- **WHEN** a Codex patch adds `plan.md` in the session's folder
- **THEN** World SHALL record a report at that absolute path

#### Scenario: The session changes folder
- **WHEN** a Codex turn in `/work/a` adds `plan.md` and a later turn runs in `/work/b`
- **THEN** World SHALL record `/work/a/plan.md`

#### Scenario: A reply mentions a link
- **WHEN** the agent only writes a URL in its reply
- **THEN** the record SHALL say it is a guess

### Requirement: Presence

On the local host World SHALL check each file record on every read and mark a
deleted file gone. A failed check, a remote host or a link SHALL leave presence
unknown rather than gone. Links SHALL never be fetched.

#### Scenario: The report is deleted
- **WHEN** an artefact file is removed
- **THEN** the Library SHALL mark it deleted within a minute and stop offering to open it in Files

### Requirement: One shelf per host, outliving its makers

World SHALL answer one host's artefact shelf on its immutable connection ID at
exactly its current generation, refusing any other generation and never
answering from another connection.

#### Scenario: Shelf identity and departed makers

- **WHEN** World reads a host's artefact shelf
- **THEN** The shelf SHALL hold the records of the
  host's running agents and of its agents that have gone, re-derived from the
  transcripts Apartments recorded for them, with a gone maker named as it was.
  A gone maker's room SHALL be the host's room that has the label Apartments
  recorded, when exactly one room has it now; otherwise the room SHALL be unknown
  and the record SHALL keep that label as the room's name as it was.
  One record SHALL stand per ID, a running maker's first, newest first, at most
  400, saying when more were found. The shelf SHALL be derived on each read and
  SHALL NOT be stored.

#### Scenario: The agent is stopped
- **WHEN** an agent that wrote a report is stopped
- **THEN** the report SHALL stay on its host's shelf, its maker named as it was
- **AND** the Library's reader for its room and a search for the room's name
  SHALL still find it

#### Scenario: A stale generation asks
- **WHEN** the shelf is asked for a host's earlier generation
- **THEN** World SHALL refuse rather than answer from the current one

### Requirement: The Library is the home of artefacts

The Library SHALL show a "Made by agents" wing beside memory and instructions,
filtered by the Library's own readers (everything, a project, an agent).

#### Scenario: Library readers and availability

- **WHEN** World presents or opens the Library
- **THEN** Each
  artefact SHALL show its kind, title, maker, project, when it was made, and
  whether it was deleted or is a guess. The Library's search SHALL find
  artefacts by title, kind, maker, project and path or link, alongside memory.
  Opening one SHALL show it in the Library's reader (Markdown, text, images and
  PDFs), with **Open in Files** for a file, which opens a live agent's Inspector
  at Files on that path on its own connection, and **Open link** for a link,
  which opens a new tab without an opener. Town's Library sign SHALL count the
  artefacts on its shelves.

  A live host with no agent whose harness has a memory adapter (every agent on
  it stopped) SHALL still offer the Library while its shelf holds something
  agents made: Town's sign (counting only what was made), the town center's and
  Board's Library entries, Settings and the command box SHALL open it on that
  wing alone, without reading or offering to edit the host's memory, and its
  search SHALL look through the made things only. A made file SHALL be read
  through its maker's room when no agent there runs. Memory SHALL return when
  an agent with a memory adapter starts on the host. A host with neither SHALL
  offer no Library.

#### Scenario: Search finds a report
- **WHEN** the owner searches the Library for words in a report's title
- **THEN** the report SHALL be listed under "Made by agents" and open in the reader

#### Scenario: Every agent on the host has stopped
- **WHEN** a Claude Code agent wrote a report and then every agent on its host stopped
- **THEN** the Library SHALL still open from Town and the command box
- **AND** its "Made by agents" shelf SHALL list the report with its maker named as gone
- **AND** Town's Library sign SHALL count what was made

#### Scenario: A link is opened
- **WHEN** the owner opens a published link from the Library
- **THEN** it SHALL open in a new browser tab without an opener

### Requirement: Made summaries and Chat cards

An agent's Desk card, Town peek and Chat SHALL each show a short "Made"
summary (the count and the latest one or two titles) that opens the Library's
"Made by agents" wing on that agent. Chat SHALL show each artefact made in the
conversation as a small card (kind, title, Open) at the time it was made, which
opens that artefact in the Library. No view SHALL keep its own artefact list.

#### Scenario: Open what an agent made from Desk
- **WHEN** the owner clicks an agent's "Made" summary on Desk
- **THEN** the Library SHALL open on that agent's artefacts

### Requirement: References only, for the signed-in owner

Artefact titles, paths and links SHALL travel only on authenticated owner reads.
World SHALL store references only and SHALL NOT copy artefact content into any
World store or cache; the reader's content SHALL leave with the reader.

#### Scenario: A report is read in the Library
- **WHEN** the owner reads a report in the Library
- **THEN** World SHALL read it from its host when shown and keep no copy
