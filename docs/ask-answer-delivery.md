# Planned answer delivery without `--wait`

Current behavior: retrieve an answer with `herdr-world ask get ID` or `--wait`.
The SQLite foundation creates no pending pane-answer sends.

The planned PR 2 contract, architecture choices and acceptance cases are in the
[OpenSpec proposal](../openspec/changes/ask-answer-delivery/proposal.md),
[design](../openspec/changes/ask-answer-delivery/design.md) and
[delta specification](../openspec/changes/ask-answer-delivery/specs/ask-answer-delivery/spec.md).
It is not implemented. It uses a distinct queueable, state-conditioned, opaque
answer verb through Chat's existing guarded send path; ordinary Chat and terminal
input remain direct. Uncertain pane submission never automatically replays.
