## Why

Town grouped a machine's Herdr TUI and herdr-core into one building, but the
choice was a browser-local Town setting, and the navigator and Desk still
listed every runtime as its own host. One machine looked like one place in
Town and two places everywhere else, and each browser could disagree.

## What Changes

- One **Group runtimes** setting under Settings → This World (one per
  machine by default, or one per runtime), stored in the World service's UI
  settings and pushed to every browser; the browser keeps a read-through
  copy only.
- A shared derivation over World's host catalogue gives every view the same
  groups: Town's buildings, the common navigator (a machine heading with a
  row per runtime) and Desk's other-host summaries.
- A browser's earlier Town buildings choice moves to the service once, while
  the service has none.
- Town's own Town buildings setting is removed; the `?townBuildings=` page
  flag stays as a Town comparison override.

## Capabilities

### Modified Capabilities

- `world-surfaces/town`: Town scene names World's Group runtimes setting
  instead of a browser-local Town setting.
- `world-surfaces/shell-navigation`: adds One runtime grouping for every view.

## Impact

Web settings (`web/src/world/runtimeGrouping*.ts*`, `web/src/store/uiSettings.ts`),
the host catalogue (`web/src/worldHosts.ts`), Town buildings, the navigator and
Desk. Storage: `ui.runtimeGrouping` in the service's settings and the
`runtimeGrouping.v1` browser cache, both listed in the storage catalog.
Room and desk visuals (#1255) and agent moves are out of scope; Board keeps
its per-connection zones.
