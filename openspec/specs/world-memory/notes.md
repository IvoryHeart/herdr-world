# Memory notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Town Library building, town center ring, Board hub and supported agent Settings open one Library.
- Readers select host/project/agent; shelves support search, fresh reads and explicit revision-checked edits.
- CLI memory list/search/read/create/update/delete shares the API; memory demo --json is synthetic.
- TUI/core share adapters and host routing; Unix hosts need Python 3, Windows refuses.

**Code:**

- `shared/memory.ts`
- `server/src/memory/service.ts`
- `server/src/memory/worker.py`
- `server/src/cli/memory.ts`
- `web/src/world/memory/MemoryLibrary.tsx`
- `web/src/features/memory/mount.tsx`

**Tests:**

- `server/src/memory/service.test.ts`
- `server/src/memory/routing.test.ts`
- `server/src/cli/memory.test.ts`
- `web/src/world/memory/MemoryLibraryLifecycle.browser.test.ts`

**Pitfalls:**

- Adapter support controls visibility, not a nonzero file count.
- Missing files can offer creation; browse-only .mdc rules cannot offer editing.
- The chosen connection/generation and reader fence every late result; never substitute a host.
- Unknown saves need a fresh read; only exact draft equality can adopt a new revision.
- Limits are contracts in spec.md; discovery is never proof a harness loaded those files.
