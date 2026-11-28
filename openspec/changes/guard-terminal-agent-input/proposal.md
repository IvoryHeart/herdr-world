## Why

Issue #1437 demonstrated an ask answer being typed into bash after its agent exited. Owner and agent text must never become shell commands. The owner replaced original-session matching with a send-time program check on 2026-11-27.

## What Changes

- Share one foreground program check across answers, Chat, notification replies, prompts, menu text and launch/Board prompts on both runtimes.
- Refuse shells, interactive REPLs, editors/pagers, ssh, sudo/su and database clients, including foreground children. Classify shells by basename regardless of arguments, and refuse multiplexers and nested shell launchers. Tool children under an admitted leader are temporarily busy; empty command lines and failed reads are temporarily unavailable, with zero input.
- Admit all other programs, including arbitrary agents, resumed/restarted agents, wrappers and npm entrypoints. Remove the per-session foreground witness and PID hashing introduced by this change.
- Treat failed reads as temporary. Preserve qualified terminal/runtime authority and no-replay handling for refused or uncertain sends. Show plain Not sent reasons and answer recovery.

## Capabilities

### Modified Capabilities

- `ask-answer-delivery`: current foreground program admission and saved-answer recovery.
- `world-surfaces/chat`: shared send-time program checks for World agent input.

## Impact

Shared TUI transport, core native/Chat sends and durable answer dispatch. No new store or persisted field. Explicit owner Terminal input retains its existing authority. Current runtimes lack atomic OS foreground-and-send; a process switch after the last observation remains an upstream limit.
