## Decisions

Use qualified current World space admission for movement, never rename. Core
spots are World-owned; actionable TUI spaces also synchronize native ordering.
Reserve immovable rooms before collision placement. Tidy and Undo use current
room authority and the same placement/save path; the save validates all changed
spots. Preserve unavailable TUI rooms in native order as well.

## Verification

Use the actual projection, building grouping, room actions, Board patch and TUI
order paths with synthetic runtimes. Exhaust all movable subsets of a bounded
building and all before/after Undo authority combinations. These synchronous
placement decisions add no asynchronous state machine, queue or recovery store;
existing Board conflicts and qualified runtime RPC gates retain their owners.
No new Quint model is needed for this finite geometric/authority decision.
