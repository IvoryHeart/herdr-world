## Why

Agents make more than code: reports, plans, documents, pages, diagrams,
screenshots and published links. Today they are buried in transcripts and
folders. World should show them as things of their own, tied to the agent and
room that made them, in the place World already keeps what agents know: the
Library (#1327).

## What Changes

- Derive one artefact record per agent session from the harness's own
  transcript (Claude Code and Codex): title, kind, where it lives (file path or
  link), when, how it was found, whether a file still exists and its maker.
- Carry the records on the existing per-agent desk read, and serve each host's
  whole shelf (running agents plus agents that have gone, from Apartments'
  records) through one read, `world.artefacts.list`.
- Add a **Made by agents** wing to the Library beside memory and instructions:
  the Library's readers (everything, a project, an agent) filter it, its search
  finds artefacts alongside memory, and its reader shows Markdown, text,
  images and PDFs, with **Open in Files** for a file and **Open link** for a
  link. Town's Library sign counts them. A host whose agents have all
  stopped keeps the Library for what they made (#1342).
- Desk cards, Town peeks and Chat show a short **Made** summary (the count and
  the latest one or two) that opens the Library on that agent; Chat also shows
  each artefact as a small card in the turn that made it.
- No Board element: artefacts are not Board things.

## Capabilities

### New Capabilities

- `world-artefacts`: discovery, the record, presence, the Library wing, the
  views' summaries, opening and privacy.

### Modified Capabilities

- `world-memory`: a host without a memory adapter offers the Library while
  agents made something there, showing only that.

## Impact

Shared record (`shared/agentArtefacts.ts`), transcript discovery
(`server/src/agent/artefacts.ts`), the `agent_quest.list` row, a read-only
`world.artefacts.list` feature, the browser desk-read hook, the Library, Desk,
Town and Chat. No new storage table or file, no content copies and no fetching
of links. Gone agents' artefacts are re-derived from their transcripts, which
Apartments already records by session. Pi, Kimi, OpenCode and other harnesses
are left for later (see design).
