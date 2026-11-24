## Why

Worlds with separate data folders could not discover each other, so owner questions stayed in their home World.

## What Changes

- Share a private per-user instance registry by default, independently of data folders, retaining the explicit registry override.
- Keep question storage and runtime endpoint matching unchanged; non-publishing older Worlds contribute no questions or discovery errors.

## Capabilities

### Modified Capabilities

- `ask-answer-delivery`: default discovery across separate data folders.
- `world-shipyard`: shared per-user instance observations.

## Impact

Default registry path selection, cross-World question tests and platform/private-permission checks. Existing home-ledger closure authority is unchanged.
