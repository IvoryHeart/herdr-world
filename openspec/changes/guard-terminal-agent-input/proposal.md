## Why

Issue #1437 demonstrated an ask answer being typed into bash after its agent exited. Owner and agent text must never become shell commands. The owner replaced original-session matching with a send-time program check on 2026-11-27.

## What Changes

- Share one foreground leader executable-basename check across answers, Chat, notification replies, prompts, menu text and launch/Board prompts on both runtimes.
- Refuse shells, REPL interpreters, editors/pagers, ssh, sudo/su, database clients, tmux/screen/zellij and docker, ignoring arguments. Admit other executable basenames.
- Ignore children and MCP helpers; remove tty-reader code and input-specific /proc inspection. With no runtime foreground information, preserve pre-PR behavior, including macOS, remote cores and TUI without process info.
- Preserve qualified terminal/runtime authority and no-replay handling for refused or uncertain sends. Show plain Not sent reasons and saved-answer recovery.
- Document the limit of a shell started inside a live harness and the missing-information fallback.

## Capabilities

### Modified Capabilities

- `ask-answer-delivery`: current foreground program admission and saved-answer recovery.
- `world-surfaces/chat`: shared send-time program checks for World agent input.

## Impact

Shared TUI transport, core native/Chat sends and durable answer dispatch. No new store or persisted field. Explicit owner Terminal input retains its existing authority. Current runtimes lack atomic OS foreground-and-send; a process switch after the last observation remains an upstream limit.
