## Discovery (read-only, from harness records)

Claude Code and Codex transcripts are already projected to ATIF steps for
Chat and quests. Artefacts are read from the same bound projection, so no new
file is opened and nothing is typed into an agent.

| Source | Harness | Reliability |
| --- | --- | --- |
| `Write`/`NotebookEdit` tool call naming a path | Claude Code | Reliable: the harness's record of creating the file |
| `apply_patch` `*** Add File:` header, resolved against the session cwd | Codex | Reliable |
| URLs printed by `gh pr/issue/gist/release create`, deploy or publish commands | both | Reliable for "published" |
| URLs in the agent's own reply | both | A guess: it may only mention a link; shown in italics |
| Files written by shell redirection or scripts | both | Not detected |
| Edits of existing files, code and config files | both | Not artefacts (git tracks them) |
| Output folders without a transcript record | both | Not scanned (would be a guess) |

Kinds come from the file name: Markdown/text/PDF are documents, or reports
when the name says report/plan/proposal/summary/review and similar; HTML is a
page; PNG/JPEG/SVG and similar are images; CSV, diagrams and notebooks are
files.

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
transcripts are bound; herdr-core agents once core quest reads exist.
