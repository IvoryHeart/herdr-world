### Fixed

- Show a core agent run by a wrapper (`bash run.sh` piping `claude -p`, `sh -c "claude …"`) at its desk on a local Linux core, and count a live headless run (`claude -p`, `codex exec`) as working.
- Send an agent killed mid-turn to the bar instead of leaving it working at its desk on a stale report.

### Changed

- Town's lights follow where agents are: a room is lit while an agent works at a desk there, the bar is lit while anyone is in it, and lights change as agents sit down or stand up rather than ahead of the walk.
