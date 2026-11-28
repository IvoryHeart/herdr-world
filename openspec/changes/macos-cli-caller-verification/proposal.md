## Why

CLI callers on macOS are always unverified because the endpoint only looks up
Linux processes. A refused keyed ask also loses its refusal code and reason in
the CLI fallback, making it look like a lost recording reply (#1393, #1492).

## What Changes

- Verify local macOS callers by loopback socket ownership and pane ancestry.
- Name unavailable caller verification in refused asks on unsupported platforms.
- Preserve refusals without a fallback alert; distinguish unknown recording from
  confirmed rejection in CLI JSON.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-identity`: bounded local CLI caller verification on Linux and macOS.
- `ask-answer-delivery`: explicit refusal and uncertain recording outcomes.

## Impact

Authenticated CLI endpoint, OS process inspection, CLI ask output and installed
agent guidance. No storage, runtime protocol, browser UI or dependencies change.
Issue #1492 authorizes this implementation; no owner decision is outstanding.
