## Why

Data model step 2 (#1253): each concept needs one source. The legacy ledger JSON
was re-imported whenever its hash changed, so an older binary's JSON stayed a
second writer, and imported JSON, backups and per-upgrade snapshots piled up
beside the live data.

## What Changes

- Import the legacy ledger once; a completed import never reads the JSON again.
- Move imported Board, ledger and agent-profile JSON and their backup copies to
  `<data>/legacy/` by hard link plus verify. Never delete them.
- Keep the newest three schema snapshots beside `world.sqlite`; move older ones
  to `<data>/legacy/`. No automatic retention.

## Capabilities

### Modified Capabilities

- `world-storage`: one-time legacy import, the legacy folder and snapshot placement.

## Impact

Storage writer open path, ledger import and deployment guidance. No schema,
RPC, UI or configuration change. Older binaries skip a missing legacy file.
Integrations `.disabled` files honouring the data folder is left for #1237.
