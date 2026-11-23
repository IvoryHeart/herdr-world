# World artefacts

## Purpose

Show what agents make (reports, documents, pages, images, published links) as
World things tied to the agent and room that made them.

## ADDED Requirements

### Requirement: One derived artefact record

World SHALL derive each agent's artefacts on the server from that agent's bound
harness transcript and carry them on the per-agent desk read, for Herdr and
herdr-core agents alike. Each record SHALL hold a stable ID for its place on
its connection, title, kind (`document`, `report`, `page`, `image` or `file`),
where it lives (an absolute file path on the agent's host or an HTTP(S) link),
when it was made, its evidence, whether the file still exists and its maker:
the immutable connection ID, pane ID, harness and the room (workspace) it was
made in. The room SHALL be the one World first saw it in, kept while the
service runs even if the agent moves rooms. Records SHALL be newest first, one
per place, at most 24 per session. Views SHALL display these records only and
SHALL NOT derive or keep their own maker, room or record.

#### Scenario: The same file is written twice
- **WHEN** an agent writes the same report path twice
- **THEN** World SHALL show one record dated by the later write

#### Scenario: The same path on two hosts
- **WHEN** agents on two connections each write `/work/report.md`
- **THEN** World SHALL give the two records different IDs

#### Scenario: The agent moves rooms
- **WHEN** an agent that made a report moves to another workspace
- **THEN** the record SHALL keep the room it was made in

#### Scenario: A herdr-core agent makes a report
- **WHEN** a Claude Code agent run by herdr-core writes a report
- **THEN** its Desk card SHALL list it, read through its own core connection

#### Scenario: A session is only guessed
- **WHEN** the agent's transcript binding is a guess
- **THEN** World SHALL show no artefacts for it

### Requirement: Discovery from harness records

For Claude Code and Codex, World SHALL treat a file-creating tool call naming a
path, and a patch that adds a file, as reliable evidence, resolving relative
paths against the working folder the transcript recorded for that call (a
shell call's own `workdir` first), never against a later folder. A call the
transcript does not place SHALL resolve only when the session used one folder. Links printed by publishing
commands SHALL be reliable published links. Links the agent wrote in its reply
SHALL be marked as a guess and shown as one. Edits of existing files, code and
configuration files, harness bookkeeping and links carrying credentials SHALL
NOT be artefacts. World SHALL NOT open, type into or otherwise act on the agent.

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

On the local host World SHALL check each file record on every desk read and
mark a deleted file gone. A failed check, a remote host or a link SHALL leave
presence unknown rather than gone. Links SHALL never be fetched.

#### Scenario: The report is deleted
- **WHEN** an artefact file is removed while its agent card is shown
- **THEN** the card SHALL mark it deleted within a minute and stop offering to open it

### Requirement: Views and opening

The agent's Desk card and Town peek SHALL list its artefacts and Desk rows and
Town seats SHALL show that it made some. Every record SHALL be reachable: a
list cut short SHALL expand in place to show the rest. Opening a file SHALL
open the agent's Inspector at its Files view on that path; opening a link
SHALL open it in a new browser tab without an opener. Each artefact SHALL
offer to add it to Board as an `artefact` element that references the record's
maker and room.

#### Scenario: Open a report from Desk
- **WHEN** the owner clicks a report on an agent's Desk card
- **THEN** the agent's Inspector SHALL open the report in Files

#### Scenario: The fifth artefact
- **WHEN** an agent made five artefacts and its card shows four
- **THEN** "+1 more" SHALL show the fifth, which opens and pins like the rest

### Requirement: References only, for the signed-in owner

Artefact titles, paths and links SHALL travel only on authenticated owner reads.
World SHALL store references only and SHALL NOT copy artefact content into any
World store, cache or Board row.

#### Scenario: An artefact is added to Board
- **WHEN** the owner adds an artefact to Board
- **THEN** Board SHALL save its place and maker only, and read content through the Files seam when shown
