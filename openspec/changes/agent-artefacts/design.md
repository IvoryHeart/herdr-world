## Discovery (read-only, from harness records)

Claude Code and Codex transcripts are already projected to ATIF steps for
Chat and quests. Artefacts are read from the same bound projection, so no new
file is opened and nothing is typed into an agent.

| Source | Harness | Reliability |
| --- | --- | --- |
| `Write`/`NotebookEdit` tool call naming a path | Claude Code | Reliable: the harness's record of creating the file |
| `apply_patch` `*** Add File:` header, resolved against that turn's cwd (or the call's `workdir`) | Codex | Reliable |
| URLs printed by `gh pr/issue/gist/release create`, deploy or publish commands | both | Reliable for "published" |
| URLs in the agent's own reply | both | A guess: it may only mention a link; marked "guess" |
| Files written by shell redirection or scripts | both | Not detected |
| Edits of existing files, code and config files | both | Not artefacts (git tracks them) |
| Output folders without a transcript record | both | Not scanned (would be a guess) |

Kinds come from the file name: Markdown/text/PDF are documents, or reports
when the name says report/plan/proposal/summary/review and similar; HTML is a
page; PNG/JPEG/SVG and similar are images; CSV, diagrams and notebooks are
files.

Relative paths resolve per call: Codex records its cwd in `session_meta` and
each `turn_context`, Claude Code on every record. A call the transcript does
not place resolves only when the session had one folder.

## Identity and maker

An artefact ID hashes the connection ID with the place, so the same path on
two hosts is two artefacts. The service attaches `made_by` (connection, pane,
harness, session, room) once per desk read. The room is first-seen per
artefact, pane and transcript in a bounded in-memory map, so a moved agent
keeps its artefact's room until the service restarts, and another agent
recreating a deleted path gets its own room; after a restart the current room
is used. The map is keyed by the transcript World actually read, not the
session the runtime reports, because a reported session can outlive its
transcript.

## The shelf

`world.artefacts.list {connection_id, connection_generation}` answers one
host's shelf at exactly that generation, or refuses. It is derived on each
read and never stored:

- running agents: the records on their desk reads;
- agents that have gone: Apartments' residents on that host (newest 40 by
  move-out), whose transcripts are found by session ID as Apartments' history
  does, each re-read at most every ten minutes. These records carry the
  resident's name as `gone_maker`, so the maker stays named as it was.

One record per ID, a running maker's winning, newest first, at most 400 with
`truncated`. A host on which no agent has run since World started keeps
nothing; that is the Apartments record's reach.

## Views

The Library is the only list. Its wing filters the shelf with the Library's
own reader (an agent by pane ID, a project by room) and searches title, kind,
maker, project and place with every word required. The reader reads a file
through `file.read` in a live agent's room on that host (PDFs through the
workspace file URL), and its content leaves with the reader. **Open in Files**
opens the maker's (else a room-mate's, else any) Inspector at Files on that
path.

Desk, Town peeks and Chat show a summary, never a list: Desk and Town from the
desk read they already make (refreshed every 30 s while an agent has
artefacts, so a deleted file turns gone within a minute), Chat from its host's
shelf in the Library's browser store. Chat places each record's card at its
`made_at` in the conversation. Town's Library sign adds "N made" from the same
shelves it reads for memory.

## Presence

Local hosts stat each file path on every read (bounded to 24 records per
session). Remote hosts and links are not probed, so `exists` is null there.

## Other harnesses

Each needs an ATIF projection of its transcript plus the names of its
file-creating tool and its patch format: Pi, Kimi and OpenCode once their
transcripts are bound. herdr-core agents answer the same desk read
(`agent_quest.list` is a core host method).
