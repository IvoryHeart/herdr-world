## Why

Data model step 3 (#1254) retires obsolete SQLite tables without losing live
CLI history, pending profile imports or private historical review receipts.

## What Changes

- Append schema 17: immutable Board elements already owns version 16.
- Copy command history to `command_changes`, verify counts and keep the renamed
  `retired_ledger_changes` source for one release. History and conditional undo
  retain every field and the 2000-row limit.
- Fold import markers and pending profile metadata into JSON `meta` rows.
- Privately export every retired completion receipt before dropping its table;
  remove live conversion and expiry. Historical schema-9 upgrades preserve every
  receipt rather than evicting on count overflow; the byte bound fails closed.
- Keep the existing consistent pre-upgrade snapshot and all legacy files.

## Capabilities

### Modified Capabilities

- `world-storage`: safe table retirement and terminal review export.

## Impact

Storage migration, importers, CLI persistence, retirement consumers and evidence.
No RPC shape or browser flow changes. Stop World and restore the snapshot named
by an upgrade failure to roll back; older binaries refuse newer schema versions.
