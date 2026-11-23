## Why

Town grouped a machine's Herdr TUI and herdr-core into one building, but the
choice was a browser-local Town setting, and the navigator and Desk still
listed every runtime as its own host. One machine looked like one place in
Town and two places everywhere else, and each browser could disagree.

## What Changes

- One **Group runtimes** setting under Settings → This World (one per
  machine by default, or one per runtime), stored in the World service's UI
  settings and pushed to every browser with the service's commit revision;
  the browser keeps a read-through copy only and settles on the newest
  revision it has seen.
- A shared derivation over World's host catalogue gives every view the same
  groups: Town's buildings, the common navigator (a machine heading with a
  row per runtime), Desk's other-host summaries and Board's zones (one zone
  per machine with a row per runtime, each runtime keeping its own cards,
  positions and operations).
- A browser's earlier Town buildings choice moves to the service once, as an
  only-if-absent write the service applies inside its serialized settings
  writer, so it never replaces a saved value.
- Town's own Town buildings setting is removed; the `?townBuildings=` page
  flag stays as a Town comparison override.

## Capabilities

### Modified Capabilities

- `world-surfaces/town`: Town scene names World's Group runtimes setting
  instead of a browser-local Town setting.
- `world-surfaces/shell-navigation`: adds One runtime grouping for every view.
- `world-surfaces/board`: adds Board zones follow Group runtimes.

## Impact

Web settings (`web/src/world/runtimeGrouping*.ts*`, `web/src/store/uiSettings.ts`),
the UI settings RPC (`server/src/bridge/settings-rpc.ts`: commit revisions and
`only_if_absent`), the host catalogue (`web/src/worldHosts.ts`), Town
buildings, the navigator, Desk and Board. Storage: `ui.runtimeGrouping` in the service's settings and the
`runtimeGrouping.v1` browser cache, both listed in the storage catalog.
Room and desk visuals (#1255) and agent moves are out of scope.
