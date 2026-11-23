# Artefacts notes

[Contract](../../changes/agent-artefacts/specs/world-artefacts/spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- The Library is the home: its **Made by agents** tab (beside Memory) lists one host's artefacts, newest first, filtered by the Library's reader (everything, a project, an agent). Each row shows kind, title, maker, project and age, with "deleted" and "guess" marks; a gone maker reads "name (gone)".
- The Library's search box finds artefacts by title, kind, maker, project and path or link ("Made by agents N found", above memory results).
- Picking one opens it in the Library's reader: Markdown, text, images and PDFs; **Open in Files** (a file, opened in a live agent's Inspector, Files view) and **Open link** (a new tab).
- Town's Library sign adds "N made". Settings and Cmd+K find the Library by "made", "artefacts" or "reports".
- Desk cards, Town peeks and Chat show a **Made N** summary with the latest one or two titles; it opens the Library on that agent. Desk rows show "N made".
- Chat shows each artefact as a small card (kind, title, Open) at the time it was made; Open opens it in the Library.
- herdr-core agents show artefacts too: core answers `agent_quest.list`.
- Testing switch: `?memoryFixture` adds a synthetic shelf with a report, a published link, a guessed link, a deleted file and an image whose maker has gone.

**Code:**

- `shared/agentArtefacts.ts` (record, kinds, wire check, shelf)
- `server/src/agent/artefacts.ts` (discovery and presence)
- `server/src/agent/session-projection-cache.ts` (derived with the quest; creator room)
- `server/src/agent/herdr-conversation.ts` (`agent_quest.list` rows)
- `shared/coreHostMethods.ts`, `server/src/rpc/core-host.ts` (core desk read)
- `server/src/world/artefact-shelf.ts` (one host's shelf: running and gone makers)
- `server/src/world/apartment-history.ts` (`resolveResidentSession`, shared with Apartments' history)
- `server/src/features/artefacts/` (`world.artefacts.list`)
- `web/src/world/agentQuests.ts` (`useAgentDeskReads`, refresh while shown)
- `web/src/world/memory/artefactShelfClient.ts` (browser shelf store, one read a minute per host generation)
- `web/src/world/memory/artefactShelfModel.ts` (readers, search, maker, summary, readable kinds)
- `web/src/world/memory/LibraryArtefacts.tsx`, `libraryArtefacts.css` (rows and reader)
- `web/src/world/memory/MemoryLibrary.tsx` (the tab, search and reader wiring)
- `web/src/world/memory/MemoryLibraryHost.tsx` (`artefactRoute`: room to read, Open in Files)
- `web/src/world/memory/artefactFixture.ts` (`?memoryFixture` shelf)
- `web/src/world/town/TownLibrary.tsx` (sign count)
- `web/src/world/MadeSummary.tsx`, `madeSummary.css` (Desk and Town summary)
- `web/src/components/chat/ChatMade.tsx`, `chatMade.css` (Chat summary and cards)
- `web/src/world/DeskView.tsx`, `web/src/world/TownView.tsx`, `web/src/world/town/TownPeek.tsx`
- `web/src/world/artefactOpen.ts`, `web/src/world/WorldInspectorConversation.tsx` (Files open request)

**Tests:**

- `server/src/agent/artefacts.test.ts`
- `server/src/agent/conversation-matrix.test.ts`
- `server/src/herdr-core/agent-sessions.test.ts` (core desk read)
- `server/src/world/artefact-shelf.test.ts`
- `web/src/world/agentQuests.test.ts`
- `web/src/world/memory/artefactShelf.test.ts`
- `web/src/world/town/townLibrary.test.ts` (sign)

**Pitfalls:**

- Views only display records from the desk read or the shelf; never derive or keep an artefact list in a view.
- Only Claude Code and Codex transcripts are read, on Herdr and herdr-core alike.
- IDs hash the connection with the place; never compare artefacts across connections by path.
- Relative paths resolve against the cwd recorded for that call, never the latest one.
- The creator room is first-seen in memory per transcript; after a service restart a moved agent's artefact takes its current room.
- Gone makers come from Apartments' residents (newest 40 per host); an agent World never saw run leaves nothing.
- The Library opens only while a live agent with memory support runs on that host, as for memory.
- Remote hosts and links are never probed, so their presence is unknown, not gone.
- Files written by shell redirection are not found; only the harness's own write and add-file records count.
- World stores references only; the reader's content leaves with it.
