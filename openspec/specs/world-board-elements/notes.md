# Board element data notes

[Contract](spec.md).
Data, service, API and CLI foundation; #1030 owns presentation.

**Surfaces:**

- Existing Board records, authenticated browser RPC and local agent CLI.
- One shared TUI/core Files seam for project-backed source reads.

**Code:**

- `shared/boardElements.ts`
- `shared/boardElements.test.ts`
- `server/src/cli/world-elements.ts`
- `server/src/rpc/board-elements.ts`
- `server/src/rpc/board-elements.test.ts`
- `server/src/service/board-element-sources.ts`
- `server/src/service/board-element-sources.test.ts`
- `server/src/world/board-element-service.ts`
- `server/src/world/board-element-service.test.ts`
- `server/src/world/board-elements.ts`
- `server/src/world/world-cli-elements.ts`
- `server/src/storage/board-elements.test.ts`
- `server/src/storage/board-schema-upgrade.test.ts`
- `web/src/world/board/boardDocument.ts`

**Tests:**

- Source reads: `server/src/world/board-element-service.test.ts`.
- SQLite recovery and revisions: `server/src/storage/board-elements.test.ts`,
  `server/src/storage/board-schema-upgrade.test.ts`.
- Shared RPC/CLI transport: `server/src/rpc/board-elements.test.ts`.

**Pitfalls:**

- Saved source references never grant a replacement runtime authority.
- Removing a reference preserves source content; link reads do not fetch embeds.
- Keep the existing note/card APIs for existing kinds.

## Usage reference

### Board element data and agent CLI

The Board data API has one built-in registry for existing host, workspace, tab,
pane, sticky note, string and work kinds plus memory, saved log, document and link
references. `herdr-world board element types|list|put|delete|read` and authenticated
`world.board.elements.*` RPC share the same service. [API calls and examples](../../../docs/board-elements-api.md)
are the contract for the separate Board presentation follow-up; this delivery
adds no new Board picker or visual controls.

New elements persist locally with titles, positions, source references and
revision conflicts. Upgrades preserve existing Board and Apartments records,
including early Board previews that shared schema version 14 with Apartments.
Recovery uses the normal private backup and atomic migration transaction.
Memory reads project files/directories (`MEMORY.md` by
default); saved logs/transcripts remain readable without their original pane.
Board references coexist with the separate memory and Apartments APIs; no automatic mapping is added. Documents hold inline text or read a
project file. URL/PR/issue links are inert HTTP(S) targets: no automatic fetch or
iframe HTML. Removing an element leaves source content intact. Element edits
have no CLI history/undo; existing sticky note and card behavior is unchanged.

Project reads explicitly name the saved connection's current generation through
shared TUI/core Files handlers. `herdr-world ls --json` returns each connection's
`generation`, `connection_id`, `current` status and workspace IDs; choose a
`current: true` row and pass its `generation` to `board element read --generation`.
Refresh the listing after a generation refusal. Offline/stale sources never use
another host.
Paths stay project-relative, including symlink checks; errors omit absolute
roots. Missing/binary sources are unavailable and retired reads are refused.
Limits: 500 elements, 16,000-character inline text, 64 KiB source text, 32 directory
entries, eight concurrent source reads, plus existing Board/writer limits.
Truncation is explicit. Non-HTTP(S)/credential URLs and escaping paths are refused.
