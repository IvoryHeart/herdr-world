## Why

Issue #1437 demonstrated that a kept terminal and stale agent report can admit an ask answer into bash. Owner and agent text must never gain shell command authority.

## What Changes

- Require fresh recognized foreground harness evidence before World types agent input on either runtime, including asks, Chat, notification replies, prompt answers, menu text and launch/Board prompts.
- Capture the original TUI asker's foreground process witness in the existing recipient and recheck it at dispatch and the final input boundary. Refuse changed or unknown foregrounds, preserve ask retrieval, and expose not-attached evidence in Reception.
- Cancel native core sends when an observed foreground or runtime changes; keep uncertain sends non-replayable.

## Capabilities

### Modified Capabilities

- `ask-answer-delivery`: original agent foreground authority and retrieval-only refusals.
- `world-surfaces/chat`: shared send-time foreground checks for agent text and prompt input.

## Impact

Shared TUI transport, core recipient/native-send guards, durable ask recipients, existing SQLite recipient JSON, Chat and prompt callers. No new store or view-owned state. Unrecognized harnesses and shell wrappers without direct agent foreground evidence now refuse input. Current runtimes do not offer an atomic foreground-and-session compare-and-send; these checks bound World admission, and cannot prove the absence of an OS process switch after the last native observation.
