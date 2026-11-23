## Implementation

- [x] Import the legacy ledger once, with no re-import on a changed hash.
- [x] Move imported legacy JSON and backup copies to `<data>/legacy/` by hard link plus verify.
- [x] Move schema snapshots beyond the newest three to `<data>/legacy/`; never delete.
- [x] Pre-SQLite data folder test: same state after the move and on reopen; older importers skip missing files.
- [x] Deployment guidance and storage notes.
