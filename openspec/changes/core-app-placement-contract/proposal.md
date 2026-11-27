## Why

World's label-derived rooms disagree with Herdr's app layout and the phone's
folder fallback. The owner's 2026-11-27 decision makes World a peer editor of
the shared `herdr-app` document, replacing independent layouts and read-only
adopted-move refusal.

## What Changes

- Deliver a sourced design first, then reads, then writes/migration, each in
  its own PR. This PR is the design step only.
- Observe document spaces, names, tabs and changes in the unified World object;
  use folder grouping for uncovered terminals, never `where`.
- Create missing spaces and perform moves/renames through versioned document
  edits, preserving unknown fields and concurrent app edits.
- Adopt with `keep:true`; migrate existing World core rooms without replacing
  app membership or retaining a competing authoritative arrangement.
- Keep dispatcher labels unchanged; require isolated-core and actual app
  acceptance, with Town/Board/phone before/after evidence.

## Capabilities

### Modified Capabilities

- `herdr-core-runtime`: shared app placement, observation, edits and migration.

## Impact

Design-only candidate: capability notes/design and this active change. Later
PRs touch the framed client, mirror/runtime, shared topology, launch/move/rename,
legacy topology storage/catalog and Q52 coverage. No new store, dependency,
view-local arrangement or crew dispatcher changes are proposed.
