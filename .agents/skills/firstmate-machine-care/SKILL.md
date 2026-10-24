---
name: firstmate-machine-care
description: Keep a shared development machine usable while many agents run checks - check queue, load and disk watches, orphaned headless Chrome and runaway gates, and safe clean-up that never touches user data. Use when the machine is slow, the disk is filling, or gates fail with browser or space errors.
---

# FirstMate machine care

Many agents on one machine contend for CPU, memory, disk and browser lanes. The
symptoms look like test failures: headless Chrome exiting early, browser start
timeouts, `ENOSPC`, verification runs killed halfway. Treat them as machine
problems first.

## Check the machine

Run these together and log the numbers in the ledger:

```bash
uptime                                   # load against the core count
free -g | sed -n 2p                      # available memory
df -h <home-fs> /tmp | tail -n +2        # free space
pgrep -fc '^<chrome-binary> --headless'  # headless Chrome count
pgrep -fa '(^|/)bun scripts/check-delivery[.]ts( |$)' | wc -l   # real gates only
```

Anchor every `pgrep` pattern to the binary path. An unanchored pattern also
matches the shell running it (and, with `kill`, kills that shell); a loose
`check-delivery` count also counts the scripts waiting on it.

## Contention

- Heavy checks go through the repository's machine-wide queue; agents wait in
  it rather than bypassing hooks. Never tell an agent to skip a hook.
- When load stays above the threshold, let in-flight pushes finish and tell the
  other agents: no new gates until you say so. Give priority to the agent fixing
  CI or the queue itself.
- Look for one runaway process before blaming the fleet (`ps -eo pid,etime,pcpu,args
  --sort=-pcpu | head`). A script at 100% CPU for hours is a stuck agent's; ask
  that agent, or the owner, before killing it.

## Orphaned Chrome

A browser test killed from outside leaves its headless Chrome running at high
CPU. Kill only headless instances, by anchored pattern:

```bash
for p in $(pgrep -f '^<chrome-binary> --headless=new'); do kill "$p"; done
```

Never touch the owner's desktop browser or another agent's Chrome on a fixed
debugging port.

## Disk

When free space falls below the floor, the repository's gates refuse to start;
before that, clean up in this order, smallest risk first:

1. Merged, clean worktrees: the repository's prune tool (dry run first).
2. Regenerable build output in worktrees that are live agent cwds: `node_modules`,
   `dist`, `web/dist`, `server/public`, compiled binaries, verification runs.
3. Old test scratch in `/tmp` (older than 12 hours, test-owned name patterns only).
4. Anything else (caches, archives, other projects' files): **ask the owner.** Do
   not clear the package cache that worktrees hardlink from.

Never delete user data, evidence under `.agents/`, unmerged or dirty worktrees, or
a worktree a preview or live instance serves. An agent hitting `ENOSPC` stops and
tells the delegator; it deletes nothing outside its own generated output.

## Live instances

Some ports run instances the owner is using. Never restart or rebuild them
without asking (Config). Experiments against Herdr always use a throwaway
`herdr --session <name>`; the default socket is the owner's live session.

## Config

| Key | This repository's value |
|---|---|
| chrome-binary | `/opt/google/chrome/chrome` |
| home-fs | `/home` |
| load threshold | sustained load above the core count |
| disk floor | gates refuse below 3 GB free (`HERDR_WORLD_MIN_FREE_GB`) |
| check queue | `scripts/check-lock.ts`: 1 browser, 1 verification, 2 light slots |
| prune tool | `bun run agent:worktree -- prune --dry-run` |
| live instances | 8787 release, 8788 main; 8789 is the owner's test instance: ask first |
| who cleans | machine clean-up: delegator with the owner; project clean-up tooling: `devops` |
