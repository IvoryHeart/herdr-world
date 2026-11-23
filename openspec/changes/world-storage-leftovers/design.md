## Context

The integration base already uses schema 16 for Board elements. Several named
leftovers still have live consumers: CLI changes and pending profile imports.
The owner requires preserving them, including all undo fields and the existing
2000-row history limit. Historical review receipts must be exported, not expired.

## Decisions

- Append schema 17; keep version numbers and original upgrade order intact.
- Keep the existing single worker and migration transaction. Copy history with
  rowids and raw bodies to `command_changes`, check counts, rename the old table
  for one release and transfer its ID-reservation trigger to the live store.
- Use JSON-valued `meta` rows for unchanged import markers and ordered profile
  metadata. Keep profile operations behind their existing savepoints and port.
- Publish content-addressed private review JSON through the existing atomic
  no-overwrite file helper. Verify bytes before any table removal. Files survive
  transaction rollback and are verified on retry. Historical count overflow no
  longer evicts receipts; excessive serialized bytes refuse the whole upgrade.
- Remove obsolete live receipt conversion/TTL consumers and their fault controls;
  retain active Desk/watch ownership, publication and crash coverage.
- Declare changed stores in the storage catalog. Broad catalog completeness is
  the separate data-model step 1 and is not introduced by this cleanup.

## Recovery and evidence

The existing VACUUM INTO snapshot precedes mutation. Any export/copy failure
rolls back the schema transaction and names that snapshot. Stop World and
restore the named snapshot before running an older binary. Legacy JSON movement
continues to use hard link plus verification; exports and user data are never
automatically removed. Tests compare every protected table count/hash on copied
synthetic folders, exercise migration failures/retry and run real CLI history and
undo on migrated data. Migration admits no concurrent operations, so direct
SQLite evidence supplements unchanged models; the full verification gate remains
required for the covered storage owners.
