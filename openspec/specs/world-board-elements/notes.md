# Board elements notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Board's **Add to Board** picker lists every registered kind; Memory, Agent log, Doc and Link are placed from it.
- Element cards on Board open a reader (side panel on desktop, bottom sheet on phones) with Edit and Remove.
- `herdr-world board element types|list|put|delete|read` and `world.board.elements.*` RPC share one service.
- TUI and core hosts share the project Files handlers; a read names its saved connection and generation.

**Code:**

- `shared/boardElements.ts`
- `server/src/world/board-element-service.ts`
- `server/src/world/board-elements.ts`
- `server/src/world/world-cli-elements.ts`
- `server/src/service/board-element-sources.ts`
- `server/src/rpc/board-elements.ts`
- `server/src/cli/world-elements.ts`
- `web/src/world/board/boardDocument.ts`
- `web/src/world/board/elements/`
- `web/src/world/BoardElements.browser.tsx`

**Tests:**

- `shared/boardElements.test.ts`
- `server/src/world/board-element-service.test.ts`
- `server/src/storage/board-elements.test.ts`
- `server/src/storage/board-schema-upgrade.test.ts`
- `server/src/rpc/board-elements.test.ts`
- `server/src/service/board-element-sources.test.ts`
- `web/src/world/board/elements/boardElements.test.ts`
- `web/src/world/BoardElements.browser.test.ts`

**Pitfalls:**

- Board's presentation table (`boardElementKinds.ts`) must name every registry kind; a test fails otherwise.
- Selectors for element cards need `.board-card.board-element*`; `.board-card` alone overrides the paper background.
- A project read never falls back to another host or a newer generation.
- Board never fetches a link; elements are not string ends yet.

## Usage reference

## Board elements

Board places four kinds of element beside its sticky notes, each drawn as a
paper thing: **Memory** (a card-index drawer) reads a project's memory file or
folder, `MEMORY.md` by default; **Agent log** (a ruled page) reads a saved log
or transcript, which stays readable after its pane is gone; **Doc** (a sheet
with a folded corner) is a page written on Board or a project file; **Link** (a
luggage tag) keeps a web address and names a GitHub pull request or issue by
its ref. Board never fetches a link; **Open link** uses your browser without
an opener or referrer.

- **Add to Board** (the square-plus beside Work; when a phone row is tight,
  the first item in **⋮**) opens the picker. It lists every Board kind; hosts,
  workspaces, tabs, panes, strings and work items say where they come from,
  with **New workspace…** and **Open Work** where they apply. A kind's short
  form asks for a title and, for project kinds, a project on a connected host
  and a path inside it. The form refuses what the service would (an empty
  title, a path outside the project, a non-HTTP(S) address or one with a user
  name or password) before anything is saved. A new element lands in the
  middle of the view, beside the last one added.
- Tap (or press Enter on) an element to read it. On a wide screen the reader
  is a panel on the right; on a phone it is a sheet from the bottom. A memory
  folder lists its first 32 entries; tap one to open it, and the back arrow
  returns to the folder. A JSON-lines transcript shows as turns (you, the
  agent, tools); a line that is not a chat message (a structured log record,
  say) stays in place as a note with its own text, and a log with no chat at
  all reads as plain text. **Show raw** shows the saved lines. Text is shown
  as text, never as HTML, up to 64 KiB, and the reader says when it is cut.
- **Edit** changes the title or source in place; **Remove** (or Delete on a
  focused card) takes it off Board and leaves the file or address alone.
  Drag a card to move it; its place is saved.
- A project element reads only from the host and workspace it was saved
  with, naming that connection's current generation. While that host is
  offline its card is dashed and says so, and the reader says the host is
  offline instead of reading; nothing ever falls back to another host. A
  missing file, a binary file, a busy service or a reconnect while reading
  each say so in plain words, with **Try again** where it can help.
- Every write is one revision-checked change, so an edit made from an older
  copy comes back as a conflict instead of overwriting. An Edit form saves
  against the version it opened; if the element changed meanwhile, the form
  stays open with your draft and says so, and reopening shows the newer one.
  Elements are not string ends yet; strings still join notes to workspaces,
  tabs and panes.

The same registry and service serve agents:
`herdr-world board element types|list|put|delete|read` and authenticated
`world.board.elements.*` RPC ([API calls and examples](../../../docs/board-elements-api.md)).
New elements persist locally with titles, positions, source references and
revision conflicts. Upgrades preserve existing Board and Apartments records,
including early Board previews that shared schema version 14 with Apartments.
Recovery uses the normal private backup and atomic migration transaction.
A Memory element reads project files; it does not open World's memory store.
An Agent log element reads a saved file; it does not link to past sessions.
Board names things plainly; Town's metaphors (Library, Apartments) stay in
Town. Element edits have no CLI history/undo; existing sticky note and
card behavior is unchanged.

Project reads explicitly name the saved connection's current generation through
shared TUI/core Files handlers. `herdr-world ls --json` returns each connection's
`generation`, `connection_id`, `current` status and workspace IDs; choose a
`current: true` row and pass its `generation` to `board element read --generation`.
Refresh the listing after a generation refusal. Offline/stale sources never use
another host.
Paths stay project-relative, including symlink checks; errors omit absolute
roots. Missing/binary sources are unavailable and retired reads are refused.
Limits: 500 elements, 200-character titles, 16,000-character inline text, 64 KiB
source text, 32 directory entries, eight concurrent source reads, plus existing
Board/writer limits. Truncation is explicit. Non-HTTP(S)/credential URLs and
escaping paths are refused.
