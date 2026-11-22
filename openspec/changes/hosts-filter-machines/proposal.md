## Why

Issue #1227: the Hosts filter listed one row per runtime connection, so a
machine running both the Herdr TUI and herdr-core appeared twice ("Linux core ·
herdr-core · ready" beside "Local · ready"), while Town already shows that
machine as one building (#1213).

## What Changes

- The Hosts filter (top bar and the phone's corner menu) lists one row per
  machine, by the machine identity Town's buildings use: this computer, or one
  SSH destination.
- Checking or unchecking a machine shows or hides all of its runtimes together.
- A row's status summarises its runtimes: one state when they agree, else
  "1 of 2 reconnecting". Per-runtime detail stays in Manage connections.
- The saved selection keeps its connection-ID form; a selection saved per
  connection widens to that connection's whole machine. The Hosts count and
  "N hosts" label count machines.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `world-surfaces/shell-navigation`: adds "Hosts filter lists machines".

## Impact

Browser only: `web/src/worldHosts.ts` (machine identity, now shared with
Town's `townRuntimes`), `web/src/world/hostsFilter.ts` and
`web/src/world/HostsControl.tsx`. The filter stays view-only; no runtime
calls, storage keys or operation targets change.
