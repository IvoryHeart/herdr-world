## Context

`WorkspaceInspectorHost.tsx` derives its checkout label and change count from `workspace.worktree.git_status`; the existing Git resource root is based on the Herdr workspace checkout/CWD. `WorldObject` already carries the selected agent's session identity, but no admitted agent checkout path. An agent may run in a different worktree from its pane's owning workspace. A path, branch or PR inferred from workspace state would misattribute another checkout's work.

## Goals / Non-Goals

**Goals:** Identify the selected agent's actual current-session checkout, show a bounded source-control summary with truthful provenance, and keep workspace Changes reachable and clearly labeled.

**Non-Goals:** Assign a PR to an agent by guessing from branch, scan terminal output/CWD, switch the workspace root, perform Git mutations in the agent checkout, or support arbitrary web links as trusted repository facts.

## Decisions

### Prove a session-bound source before implementing the view

First verify Herdr 0.9.0 can report bounded pane tokens, expose the active agent-session identity and deliver updates to World. Use the same service/CLI transport proven for task summaries. Add a narrow `herdr-world agent-checkout` report/clear command for an explicit pane, absolute checkout path and optional HTTPS PR URL. The producer may run once as a harness hook on the target host; it must not inspect browser focus. Herdr 0.9.0's [metadata contract](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/socket-api.mdx) limits one token to 80 characters and one report to 16 keys; its `agent`/`applies_to_source` guards do not protect token patches. Do not claim that those guards bind checkout tokens to a session.

### Let the exact agent session own report lifetime

At report time, read the target pane's active `agent_session` (`source`, `agent`, `kind`, `value`) and store the lowercase hex SHA-256 of `JSON.stringify([source, agent, kind, value])` alongside the checkout fields. Reject a missing or malformed field; do not normalize the identity before hashing. World recomputes that fingerprint from the current Herdr pane/session before displaying or querying Git. Omit `ttl_ms`: Herdr retains token metadata until replacement, explicit clear, pane closure or server restart. A long-running unchanged session needs no timer or renewal hook; a replacement session immediately fails the fingerprint check even if the old tokens remain on the pane. Clear removes only the namespaced checkout tokens for the exact pane, including after the agent has ended. A new report replaces all chunks atomically and clears unused old chunks in that same metadata call. A failed or unsupported session read fails the report; it never falls back to workspace or terminal CWD.

Use `agent_checkout_v`, `agent_checkout_session`, `agent_checkout_path_0` through `_8`, and `agent_checkout_pr_0` through `_3`: 15 named tokens total, within Herdr's 16-key report limit. The path is absolute UTF-8 text of at most 540 bytes, encoded as up to nine 80-character base64url chunks; the optional HTTPS PR URL is at most 240 UTF-8 bytes in up to four chunks. Base64url avoids Herdr's whitespace normalization changing a path. Every report mentions all 15 keys, setting unused chunks to JSON null, so a shorter update cannot inherit an old suffix or PR. Reject overlong or invalid values before reporting and treat malformed/incomplete token sets as unavailable. Herdr retains at most 32 keys per pane; a full pane returns a bounded failure without partial success. The token set is advisory and untrusted; the server validates the decoded path and uses a fixed read-only Git query. Confirm these bounds and atomic patch behavior against the tagged Herdr 0.9.0 schema before coding; revise this design if the runtime differs.

### Query Git on the selected connection and exact reported checkout

Expose a read-only, connection-routed resource request qualified by connection ID, runtime generation, pane ID and agent-session identity. Server re-reads current Herdr metadata before using the reported path, validates an absolute path, safely quotes/processes it on that same local or SSH runtime, and confirms it is a Git worktree/repository. Return a bounded canonical checkout root, worktree state, branch, changed-file status/count and metadata provenance. Do not accept a browser-supplied path as authority; the browser supplies only qualified identity. Use existing Git parsing/limits where applicable. No fallback to another connection or workspace CWD. A reported PR URL is a labeled harness report, not server-verified PR ownership.

### Keep Agent and Workspace scopes explicit

For an agent Inspector, Changes opens Agent checkout context when current-session metadata and Git query succeed. Show a labeled Workspace changes switch to the existing resource. If Agent checkout is unavailable, show a reason and an explicit Workspace changes choice; do not silently substitute workspace data under the agent heading. Non-agent panes and spaces retain only the existing workspace Changes view. The agent list is read-only for this release: hide or disable Stage, Unstage, Discard, Delete and other Git mutations there. Returning to Workspace changes restores its current actions. Refetch and clear the agent context when the session, generation, selected host or pane changes; delayed replies cannot update another Inspector.

## Risks / Trade-offs

- [A reported checkout path points somewhere unexpected] → Treat metadata as untrusted, use a fixed read-only Git query with safe process arguments, validate the exact selected connection and live session, and never accept a path from the browser.
- [The optional PR link is stale or inaccurate] → Label it Reported PR with its source and validate HTTPS URL shape; do not claim repository verification or infer a PR from branch.
- [The agent session is replaced while old tokens remain] → Recompute the exact session fingerprint before each Git query and presentation; show unavailable until that session reports its own checkout.
- [Herdr restarts and loses metadata] → Show unavailable and allow the harness to report again; do not infer the old path or require periodic renewal during an uninterrupted session.
- [A pane has too many existing metadata tokens] → Treat Herdr's capacity rejection as a failed report, leave Agent checkout unavailable and preserve existing tokens; do not split the report across calls.
- [A linked worktree differs from the workspace] → Display both scope names and roots so users can tell which changed-file list they are viewing.

## Migration Plan

The metadata is optional and non-durable. Existing workspace Changes behavior and stored state remain valid. No persisted World data or migration is required.
