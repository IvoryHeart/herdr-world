## Why

A Codex started on herdr-core through World's New agent shows `done`
instead of ready, and some moves then wait for an agent that never becomes
idle. A recording of World starting Codex 0.171 and Claude Code 2.1.330 on
herdr-core 0.1.21 shows why: Codex reports `working` for about 0.7 s while it
starts, so core counts turn 1 before anyone asked it anything. World launches
with `herdr.seen=0`, so Herdr's display rule (`turn > seen` is done) reads that
start as a finished turn. The result was different across runs because a World
page looking at the desk raises `herdr.seen` and hides it. The wrapper shell
does not hide the harness: World sees Codex through it from the first event.

Both harnesses end a turn that has a result with `done`; only a start ends
`idle`.

## What Changes

- An agent whose harness ends real turns with `done` (Claude Code, Codex)
  and now reports `idle` shows idle, whatever `herdr.seen` holds.
- Such a turn end pushes no "completed" alert.
- Other harnesses keep Herdr's rule: an idle turn above seen is done.
- A replay test plays the recorded core events through World's mirror,
  first sight, attention and topology.

## Impact

- `server/src/herdr-core/shared-state.ts`, `server/src/herdr-core/topology.ts`
- `server/src/herdr-core/harness-start.test.ts`, recorded fixture and its
  capture script under `server/src/herdr-core/testing/`
