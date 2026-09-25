## Why

The Spaces command palette is scoped to Spaces focus and deliberately disabled while a visual view is active. Re-enabling it unchanged could act on a hidden pane instead of the agent the user sees.

## What Changes

- Add a common Actions entry point on Office, Tree and Graph that captures the explicitly selected, connection-qualified World entity.
- Offer only existing, capability-admitted navigation and Inspector resource actions for that entity in the first release. Reuse existing room controls in their current places.
- Revalidate target connection, runtime generation and entity membership when an action is chosen; report a retired target rather than falling back to Spaces focus or another host.
- Keep terminal text input in the visible Terminal Inspector. Agent task assignment, lifecycle commands and automation are separate future contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: define visual-route Actions availability and dispatch semantics over the shared selected-host model.

## Impact

Common top bar or keyboard entry point, World action target/dispatcher, per-view selection wiring and focused browser acceptance. No new browser RPC, Herdr mutation method, terminal owner or hidden Spaces shortcut path.
