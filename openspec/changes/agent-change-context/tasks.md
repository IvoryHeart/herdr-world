## 1. Contract and server resolution

- [x] Define agent change context types, resolution source/status, and additive RPC payloads.
- [x] Add a pure server resolver for agent metadata to a validated Git checkout.
- [x] Add agent-scoped context, summary, and file handlers using the existing safe Git diff engine.
- [x] Keep agent-scoped operations read-only and reject workspace write actions for the new target.

## 2. Regression coverage

- [x] Test explicit checkout precedence over foreground/base CWD.
- [x] Test unresolved and stale paths without workspace fallback.
- [x] Test connection/generation/pane-qualified target identity.
- [x] Test additive RPC responses and read-only scope.

## 3. Inspector experience

- [x] Add agent target types and cache keys to the web Changes data path.
- [x] Render the agent source-control context, resolution source, and explicit unavailable state.
- [x] Route Changes opened from an agent pane to the agent target while preserving workspace entry points.
- [x] Add focused component/store tests for agent and workspace target separation.

## 4. Documentation and verification

- [x] Update the current world-surfaces contract and user-facing feature notes.
- [x] Run focused tests, lint/type checks, production build, and the relevant repository check.
- [x] Smoke-test the new worktree on port `8789` without changing the existing service on `8788`.
