## Why

After a native pane move, Herdr resolves the launch-time pane ID to its current
location, but World discards that returned row and records the old pane in
caller labels. Core caller records also omit the current tab. Issue #1431
requires new attribution to describe where the caller runs now.

## What Changes

- Resolve a TUI caller's launch alias through the same Herdr connection and use
  the returned canonical pane, tab and room in new actor snapshots.
- Include the current tab in core caller snapshots from World's runtime read
  model, including after room moves and resumes between runtimes.
- Keep previously recorded actor snapshots unchanged. Preserve process ancestry,
  connection/generation qualification and original answer-recipient checks.

## Capabilities

### Modified Capabilities

- `world-identity`: current caller location and historical attribution.

## Impact

Shared service caller resolution, actor JSON in the existing asks/results/history
stores, core topology descriptions and the browser's ask type. No new store,
runtime ID scheme, process environment mutation or view-local location state.
