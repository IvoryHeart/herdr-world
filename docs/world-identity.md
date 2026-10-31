# World identity storage

`WorldStorage.ids.issue(kind)` reserves an ID in `world.sqlite` and resolves only
after the worker commits. A kind is a lowercase letter prefix; the suffix is
eight independent random symbols from `0123456789abcdefghjkmnpqrstvwxyz`.
The store checks its shared registry and retries collisions, with a bounded
failure if the random source keeps repeating. Callers await issuance before
using the ID. An unused reservation is harmless and is never recycled.

The SQLite ledger uses this allocator for asks, answer occurrences, results,
history entries, operations and attention intents. Migration registers existing
SQLite IDs and historical references without renaming them. Ledger JSON imports
retain their existing record IDs and reserve them in the import transaction.
The existing import rule still strips unverified answer-recipient, occurrence
and delivery annotations. An imported ID may use any earlier format or prefix.

Reservations survive record and replay pruning and reopening the service.
A stopped data-folder backup carries its reservations; restoring it does not
restore an allocation counter or clock. New allocations draw fresh randomness.
This does not establish mathematical uniqueness against IDs absent from the
restored copy; collision checks cover the registry that copy contains.
Close refuses new allocations and drains admitted ones through the same worker.

This is the first part of the approved identity change. The lazy Board and
profile JSON families and their existing caller-supplied IDs retain their
current behavior; this allocator does not migrate those documents or advertise
a new browser capability. Source bindings and per-field claims are separate
parts. An ID itself carries no connection, runtime generation, service
incarnation or source identity, and grants no action authority. Desk marks,
the watchlist and completion seen state retain their existing lifetimes.

The [identity contract](../verification/contracts/world-identity.md) maps the
current tests and their limits. Backend allocator, import and migration tests
use temporary databases; they do not need a running World or Herdr instance.
