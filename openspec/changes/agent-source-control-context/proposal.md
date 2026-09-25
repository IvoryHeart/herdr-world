## Why

The Changes resource currently obtains branch, checkout and file status from its owning Herdr workspace. An agent can be working in another checkout or linked worktree, so the Inspector may imply that workspace changes belong to the selected agent. The existing follow-up issue asks for agent-scoped source-control context with an explicit unavailable state.

## What Changes

- Add session-qualified reporting of the active agent's checkout path and optional reported PR link through Herdr metadata, following the task-summary metadata seam once that prerequisite is proven.
- In an agent Inspector, distinguish Agent checkout from Workspace changes. Show the exact agent repository/worktree, branch and changed files from a bounded read-only Git query on the selected connection; show a reported PR link only with clear provenance.
- Show Agent checkout unavailable when trustworthy, current-session metadata is absent or invalid. Never infer it from workspace CWD, terminal CWD, or a previous agent session.
- Keep existing workspace Changes and Git mutations in their existing workspace scope. Agent checkout is read-only in this first release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: distinguish agent-specific source-control context from workspace Changes in a selected agent's Inspector.

## Impact

Herdr metadata producer, connection-qualified read-only Git query, Inspector Changes presentation and documentation. This change depends on the proven session-bound metadata contract in `session-task-summaries`; it does not introduce a World database, Git mutations against an agent path or a new browser origin.
