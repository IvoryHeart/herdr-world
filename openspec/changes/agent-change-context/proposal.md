## Why

The Inspector's Changes tab currently describes the selected Herdr workspace checkout. That is
useful for repository work performed in the workspace, but it is not evidence of what a particular
coding agent is editing: an agent can run from another checkout or worktree while the terminal pane
and the workspace continue to point at a different directory. A user needs an explicit, trustworthy
view of the selected agent's source-control context before interpreting its files or diff.

## What Changes

- Add a read-only agent change context resolved from the selected agent pane/session rather than from
  the Inspector workspace alone.
- Resolve the context on the server from Herdr's authoritative pane metadata and Git state. Prefer
  explicit agent checkout metadata when available, otherwise use the agent-reported working
  directory, and report an unresolved state when neither can identify a checkout.
- Extend Changes with an agent context strip showing the agent, resolution state, checkout path,
  repository/branch and changed-file summary. Keep Working tree, Against main and Last step scopes.
- Keep existing workspace-scoped Files and Changes behavior unchanged when no agent target is
  selected. An unresolved agent context must not silently fall back to workspace changes.
- Expose additive World RPCs for agent context and agent-scoped diff summary/file reads. Agent-scoped
  actions are read-only in this change; staging, committing, pushing and pull-request provider
  integration remain out of scope.

## Capabilities

### Modified Capabilities

- `world-surfaces`: Make an Inspector Changes view opened for an agent identify and inspect that
  agent's source-control context without conflating it with the selected Herdr workspace.

## Impact

- Server: agent-context resolution, additive RPC handlers, and reuse of the existing safe Git diff
  reader.
- Web: agent-target resource types, context-aware Changes loading/caching, and explicit unresolved or
  unavailable states in the Inspector.
- Tests and docs: resolver, RPC, and UI regression coverage plus the current surface contract.

## Non-goals

- Replacing Roamgate's workspace/worktree lifecycle or adding a second generic worktree selector.
- Inferring agent ownership from a workspace, terminal CWD, or a sibling worktree when the agent
  context cannot be resolved.
- GitHub/GitLab API integration, pull-request discovery, or write operations on the repository.
