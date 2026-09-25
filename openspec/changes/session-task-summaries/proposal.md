## Why

Office, Tree and Graph can display a Herdr task summary, but the Roamgate-derived World release has no way for an agent harness to publish one. As a result, the most useful answer to “what is this agent doing?” is usually absent even while its terminal is active.

## What Changes

- Restore a packaged `herdr-world task-summary` report/clear command that targets an exact Herdr pane and its active agent session without starting the World web service.
- Normalize, bound, redact and expire reported text; reject missing or stale targets instead of attaching text to a different agent.
- Admit report, clear and expiry updates through existing Herdr observations in all four views, with local and SSH usage documented.
- Preserve the absence of a summary when Herdr or the agent does not provide one. The command does not assign work to an agent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: add production and lifecycle behavior for the optional task summary already displayed by the shared WorldObject.

## Impact

Packaged CLI dispatch, Herdr control-client compatibility, pane metadata observation, World snapshot refresh, and Office/Tree/Graph/Inspector presentation. No new browser RPC, World-owned summary database, terminal parser or Herdr protocol extension. The former Rust implementation at commit `80e5799` is historical reference only; current Bun and Herdr 0.9.0 behavior is authoritative.
