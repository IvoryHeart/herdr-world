## Context

The shell already has an exact pane identity for the selected agent and an existing server-side Git
diff implementation scoped to a workspace. The current diff implementation is intentionally tied to
the workspace resource, while agent session resolution already obtains authoritative pane metadata
from Herdr. The new feature should add agent ownership as a separate target without changing the
meaning of workspace Changes or allowing browser-provided paths to become filesystem authority.

## Goals

- Make the selected agent's source-control target visible before showing its diff.
- Preserve the existing workspace Changes contract and Roamgate compatibility.
- Use one server-side resolution path for local and SSH connections.
- Make missing, stale, or ambiguous agent context explicit and safe.
- Keep the first slice read-only and bounded to the existing diff scopes.

## Non-goals

- A repository browser or full editor.
- A new checkout/worktree manager.
- Automatic branch creation, commits, staging, pushes, merges, or PR API access.
- Claiming that an agent owns a checkout solely because its terminal workspace has one.

## Decisions

### Agent identity is pane/session qualified

The request carries the selected `pane_id` and is evaluated within the active connection/runtime
generation. The browser cache key includes the connection and generation so equal native pane IDs on
different hosts cannot reuse one another's context.

### Server-derived resolution

The server obtains the agent from Herdr by pane ID. Resolution precedence is:

1. An explicit checkout/worktree path reported by the agent, if the runtime provides one.
2. The agent's reported foreground CWD, then its base CWD.
3. An explicit unresolved result.

The server resolves the candidate through the existing local/SSH process boundary, discovers the Git
root, and verifies it is a usable checkout before reading status. The browser never supplies a path.
If the path disappears or is no longer a Git checkout, the result is unavailable/stale rather than
redirected to the Inspector workspace or another sibling worktree.

### Additive RPC boundary

Agent-scoped context, summary, and file reads use additive `agent_changes.*` RPCs. Existing
`git.diff_summary`, `git.diff_file`, and workspace write actions retain their current contracts.
The new agent file actions do not expose stage/unstage/commit controls.

### Reuse the diff engine

After the agent target is resolved, the server passes its qualified root and metadata through the
existing safe Git diff readers. This keeps scope semantics (`working`, `branch-main`, and
`last-step`) and path validation consistent. The response includes the agent pane identity and
resolution source so the UI can explain what it is showing.

### Explicit UI states

Changes opened from an agent pane is labelled as agent-scoped and shows the resolved source-control
context. If no checkout can be resolved, the UI shows an explanatory unavailable state and offers a
clearly labelled workspace Changes fallback. It does not silently present workspace changes as agent
changes. The existing generic workspace Changes entry point remains unchanged.

## Risks and mitigations

- **Stale agent paths:** resolve and read on every request; show unavailable/stale state and do not
  fall back to another checkout.
- **Cross-host identity collision:** qualify cache and requests by connection/runtime generation and
  pane identity.
- **Path or command injection:** reuse existing allow-listed commands, quoting, path sanitization,
  and local/SSH wrappers; accept only Herdr-derived paths.
- **Misleading ownership claims:** return a resolution source and show it in the context strip; do
  not infer ownership from workspace identity.

## Validation

- Unit tests cover resolution precedence, unresolved paths, stale checkouts, and target isolation.
- Server tests cover additive context/summary/file RPCs and reject write actions for agent targets.
- Web tests cover agent-target cache identity and explicit unresolved rendering.
- Run the relevant web/server checks, production build, and local smoke validation on port `8789`.
