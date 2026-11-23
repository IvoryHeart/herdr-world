## Discovery (read-only, from harness records)

Claude Code and Codex transcripts are already projected to ATIF steps for
Chat and quests. Artefacts are read from the same bound projection, so no new
file is opened and nothing is typed into an agent.

| Source | Harness | Reliability |
| --- | --- | --- |
| `Write`/`NotebookEdit` tool call naming a path | Claude Code | Reliable: the harness's record of creating the file |
| `apply_patch` `*** Add File:` header, resolved against that turn's cwd (or the call's `workdir`) | Codex | Reliable |
| URLs printed by `gh pr/issue/gist/release create`, deploy or publish commands | both | Reliable for "published" |
| URLs in the agent's own reply | both | A guess: it may only mention a link; shown in italics |
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
harness, session, room) once per desk read. `session` fingerprints the agent
session Herdr reports for the pane, the same way World's agent leaf does
(`agentSessionFingerprint`), so it is continuity evidence: Board names the live
agent in that pane only while it runs that session, and a replacement agent of
the same harness is never credited. The room is first-seen per artefact, pane
and maker session in a bounded in-memory map, so a moved agent keeps its
artefact's room until the service restarts, and another agent recreating a
deleted path gets its own room; after a restart the current room is used.
Board saves `made_by` as the element source and names the maker from the live
World. A CLI-placed artefact has no session, so Board shows its harness.

## Presence

Local hosts stat each file path on every desk read (bounded to 24 records per
session). Remote hosts and links are not probed, so `exists` is null there.

## Views

The record rides on `agent_quest.list` beside the quest and usage stop. The
browser keeps reading every 30 s while any artefacts are shown, so a deleted
file turns "deleted" within a minute. Town draws a small paper stack beside the
quest pennant; it hides with the pennant while the agent is away.

## Other harnesses

Each needs an ATIF projection of its transcript plus the names of its
file-creating tool and its patch format: Pi, Kimi and OpenCode once their
transcripts are bound. herdr-core agents answer the same desk read
(`agent_quest.list` is a core host method).
