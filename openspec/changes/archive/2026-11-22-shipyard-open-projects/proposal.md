## Why

Shipyard built its lanes from the GitHub Sources feed (pull requests, issues and recent merges anywhere), running Worlds and cached reads, then kept the first eight alphabetically. It showed repositories nobody had open, silently dropped open projects that sorted late, and filled one lane at a time (#1226).

## What Changes

- Lanes come from the projects open in World's runtimes: each room or space (Herdr TUI or herdr-core) on a current, non-stale connection with a folder, on Unix or Windows runtimes. The release source is that folder's Git checkout's GitHub remote (`origin` first); one lane per repository. A folder without one (not a checkout, no GitHub remote, or unreadable) is listed as such in Work → Releases.
- No silent cut-off: every open project is listed. Open folders past World's bound (64) are counted and said on screen, with **Another repository…** to show one.
- Several repositories are read at once (four), the rest waiting for a slot; at most 96 pipelines are held, and a repository past that waits its turn rather than growing the cache; each lane appears as its own read lands. Per-call deadlines and the cache stay.
- Lanes follow the projects: the browser asks for them every fifteen seconds, so a closed project's lane goes and a new one joins without a reload.
- A repository typed in **Another repository…** is one extra lane while it is chosen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-shipyard`: acquisition bounds allow several concurrent reads; Town and Board presentation take their lanes from open projects.

## Impact

Server `server/src/shipyard/` (new `projects.ts`, service, HTTP/CLI catalog), `shared/shipyard.ts` catalog fields (`projects`, `pending`, `omitted`; `limits.repositories` 64, `limits.pipelines` 96, `limits.concurrentReads`), browser store and Releases tab, docs. Read-only Git (`rev-parse`, `remote -v`) per open folder, locally or over the connection's SSH destination; no new credentials.
