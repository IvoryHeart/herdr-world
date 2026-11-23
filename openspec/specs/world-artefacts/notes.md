# Artefacts notes

[Contract](../../changes/agent-artefacts/specs/world-artefacts/spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- An agent's Desk card lists **Made**: its newest four artefacts, then "+N more"; Desk rows show "N made".
- Its Town peek lists the newest three; a small paper stack beside its Town seat shows it made some (hover or tap for the latest).
- A file opens in the agent's Inspector, Files view; a link opens in a new tab; the pin adds it to Board.
- A deleted file reads "deleted" and cannot be opened or pinned; a link found only in a reply is in italics (a guess).

**Code:**

- `shared/agentArtefacts.ts` (record, kinds, wire check)
- `server/src/agent/artefacts.ts` (discovery and presence)
- `server/src/agent/session-projection-cache.ts` (derived with the quest)
- `server/src/agent/herdr-conversation.ts` (`agent_quest.list` rows)
- `web/src/world/agentQuests.ts` (`useAgentDeskReads`, refresh while shown)
- `web/src/world/ArtefactList.tsx`
- `web/src/world/artefactOpen.ts` (open in Files, add to Board)
- `web/src/world/DeskView.tsx`
- `web/src/world/TownView.tsx`
- `web/src/world/town/TownPeek.tsx`
- `web/src/world/town/TownArtefactStack.tsx`
- `web/src/world/WorldInspectorConversation.tsx` (takes the open request)

**Tests:**

- `server/src/agent/artefacts.test.ts`
- `server/src/agent/conversation-matrix.test.ts`
- `web/src/world/agentQuests.test.ts`
- `server/src/world/board-element-service.test.ts`
- `server/src/rpc/board-elements.test.ts` (CLI put)

**Pitfalls:**

- Views only display the records from the desk read; never derive artefacts in a view.
- Only Claude Code and Codex transcripts are read; herdr-core agents show none yet.
- Remote hosts and links are never probed, so their presence is unknown, not gone.
- Files written by shell redirection are not found; only the harness's own write and add-file records count.
- World stores references only; never copy artefact content into a store or Board row.
