## Context

`WorkspaceInspectorHost.tsx` derives its checkout label and change count from `workspace.worktree.git_status`; the existing Git resource root is based on the Herdr workspace checkout/CWD. `WorldObject` already carries the selected agent's session identity, but no admitted agent checkout path. An agent may run in a different worktree from its pane's owning workspace. A path, branch or PR inferred from workspace state would misattribute another checkout's work.

## Goals / Non-Goals

**Goals:** Identify the selected agent's actual current-session checkout, show a bounded source-control summary with truthful provenance, and keep workspace Changes reachable and clearly labeled.

**Non-Goals:** Assign a PR to an agent by guessing from branch, scan terminal output/CWD, switch the workspace root, perform Git mutations in the agent checkout, or support arbitrary web links as trusted repository facts.

## Decisions

### Prove a session-bound source before implementing the view

First verify Herdr 0.9.0 can attach source-specific metadata to an exact pane and active agent session, invalidate it on session replacement, and deliver updates to World. Use the same service/CLI transport proven for task summaries. Add a narrow `herdr-world agent-checkout` report/clear command for an explicit pane, absolute checkout path and optional HTTPS PR URL. The producer may run as a harness hook on the target host; it must not inspect browser focus. Store only the bounded checkout and PR fields under a World-owned metadata source with TTL and session binding. If Herdr cannot support these semantics, revise this proposal before using a World cache or inference.

### Query Git on the selected connection and exact reported checkout

Expose a read-only, connection-routed resource request qualified by connection ID, runtime generation, pane ID and agent-session identity. Server re-reads current Herdr metadata before using the reported path, validates an absolute path, safely quotes/processes it on that same local or SSH runtime, and confirms it is a Git worktree/repository. Return a bounded canonical checkout root, worktree state, branch, changed-file status/count and metadata provenance. Do not accept a browser-supplied path as authority; the browser supplies only qualified identity. Use existing Git parsing/limits where applicable. No fallback to another connection or workspace CWD. A reported PR URL is a labeled harness report, not server-verified PR ownership.

### Keep Agent and Workspace scopes explicit

For an agent Inspector, Changes opens Agent checkout context when current-session metadata and Git query succeed. Show a labeled Workspace changes switch to the existing resource. If Agent checkout is unavailable, show a reason and an explicit Workspace changes choice; do not silently substitute workspace data under the agent heading. Non-agent panes and spaces retain only the existing workspace Changes view. The agent list is read-only for this release: hide or disable Stage, Unstage, Discard, Delete and other Git mutations there. Returning to Workspace changes restores its current actions. Refetch and clear the agent context when the session, generation, selected host or pane changes; delayed replies cannot update another Inspector.

## Risks / Trade-offs

- [A reported checkout path points somewhere unexpected] → Treat metadata as untrusted, use a fixed read-only Git query with safe process arguments, validate the exact selected connection and live session, and never accept a path from the browser.
- [The optional PR link is stale or inaccurate] → Label it Reported PR with its source and validate HTTPS URL shape; do not claim repository verification or infer a PR from branch.
- [The agent context expires while open] → Clear it to an unavailable state and keep Workspace changes an explicit separate choice.
- [A linked worktree differs from the workspace] → Display both scope names and roots so users can tell which changed-file list they are viewing.

## Migration Plan

The metadata is optional and expires. Existing workspace Changes behavior and stored state remain valid. No persisted World data or migration is required.
