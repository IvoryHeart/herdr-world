# Artefacts notes

[Contract](../../changes/agent-artefacts/specs/world-artefacts/spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- An agent's Desk card lists **Made**: its newest four artefacts, then a "+N more" button that shows the rest ("Show fewer" folds them); Desk rows show "N made".
- Its Town peek lists the newest three, with the same "+N more"; a small paper stack beside its Town seat shows it made some (hover or tap for the latest).
- A file opens in the agent's Inspector, Files view; a link opens in a new tab; the pin adds it to Board with the record's maker and creator room. On Board, **Open in Files** opens any artefact file (images and PDFs too) in a live agent's Files view on its own connection.
- herdr-core agents show artefacts too: core answers `agent_quest.list`.
- A deleted file reads "deleted" and cannot be opened or pinned; a link found only in a reply is in italics (a guess).

**Code:**

- `shared/agentArtefacts.ts` (record, kinds, wire check)
- `server/src/agent/artefacts.ts` (discovery and presence)
- `server/src/agent/session-projection-cache.ts` (derived with the quest)
- `server/src/agent/herdr-conversation.ts` (`agent_quest.list` rows)
- `shared/coreHostMethods.ts`, `server/src/rpc/core-host.ts` (core desk read)
- `web/src/world/agentQuests.ts` (`useAgentDeskReads`, refresh while shown)
- `web/src/world/ArtefactList.tsx`
- `web/src/world/artefactOpen.ts` (open in Files, add to Board from `made_by`)
- `web/src/world/board/elements/boardElementRead.ts` (`artefactPlace`: maker name, Files viewer)
- `web/src/world/board/elements/useBoardElements.tsx`, `BoardElementReader.tsx` (Open in Files)
- `web/src/world/DeskView.tsx`
- `web/src/world/TownView.tsx`
- `web/src/world/town/TownPeek.tsx`
- `web/src/world/town/TownArtefactStack.tsx`
- `web/src/world/WorldInspectorConversation.tsx` (takes the open request)

**Tests:**

- `server/src/agent/artefacts.test.ts`
- `server/src/agent/conversation-matrix.test.ts`
- `web/src/world/agentQuests.test.ts`
- `server/src/herdr-core/agent-sessions.test.ts` (core desk read)
- `web/src/world/board/elements/boardElements.test.ts` (maker and viewer)
- `server/src/world/board-element-service.test.ts`
- `server/src/rpc/board-elements.test.ts` (CLI put)

**Pitfalls:**

- Views only display the records from the desk read; never derive artefacts in a view.
- Only Claude Code and Codex transcripts are read, on Herdr and herdr-core alike.
- IDs hash the connection with the place; never compare artefacts across connections by path.
- Relative paths resolve against the cwd recorded for that call, never the latest one.
- The creator room is first-seen in memory; after a service restart a moved agent's artefact takes its current room.
- Remote hosts and links are never probed, so their presence is unknown, not gone.
- Files written by shell redirection are not found; only the harness's own write and add-file records count.
- World stores references only; never copy artefact content into a store or Board row.
