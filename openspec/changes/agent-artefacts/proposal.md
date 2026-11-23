## Why

Agents make more than code: reports, plans, documents, pages, diagrams,
screenshots and published links. Today they are buried in transcripts and
folders. World should show them as things of their own, tied to the agent and
room that made them (#1327).

## What Changes

- Derive one artefact record per agent session from the harness's own
  transcript (Claude Code and Codex): title, kind, where it lives (file path or
  link), when, how it was found and whether a file still exists.
- Carry the records on the existing per-agent desk read, so Desk, Town and Board
  display one server derivation and never derive it themselves.
- Show them on the agent's Desk card (with a count on rows), its Town peek and a
  paper stack beside its Town seat; open files in the agent's Inspector Files
  view and links in a new tab.
- Add a Board `artefact` element that stores a reference only and reads the file
  through the same Files seam as the Inspector.

## Capabilities

### New Capabilities

- `world-artefacts`: discovery, the record, presence, views, opening and privacy.

### Modified Capabilities

- `world-board-elements`: the `artefact` kind and its absolute-path source.

## Impact

Shared record (`shared/agentArtefacts.ts`), transcript discovery
(`server/src/agent/artefacts.ts`), the `agent_quest.list` row, the browser
desk-read hook, Desk, Town, Inspector Files opening and the Board element
registry/service. No new storage table, no content copies, no fetching of links,
no new RPC method. Herdr-core agents and other harnesses are left for later
(see design).
