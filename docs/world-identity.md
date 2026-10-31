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

`WorldStorage.bindings` stores verified source captures alongside the ID registry.
Each binding has its own store-issued ID, its owning record/slot, adapter and source
instance, entity kind, native ID and terminal/session evidence. Listing/get reads
are unresolved captures. `resolve` returns an ephemeral qualified target only
when fresh evidence attaches; callers recheck the exact runtime lease before
acting. Incarnation and generation are request/target fences, never durable identity.
Each binding has a separate record revision. A caller captures that revision
before reading a source and supplies it to `resolve`; a newer binding edit
refuses the old observation without changing the saved binding.
An explicit unknown session is represented by terminal evidence without a session
fingerprint. Labels, directories and agent kinds prove no continuity.

The declared policies are:

| Record kind | Continuity | Absence | Ended lifetime |
| --- | --- | --- | --- |
| Board string | World's witnessed moves or an explicit user decision | Current observed close or qualified not-found | Needs a home |
| Appearance | World's moves and a uniquely witnessed terminal in a complete listing | Every witnessed terminal absent from a complete current list | Clear |
| Tab colour | Appearance's paths | Appearance's absence or observed tab close | Drop |
| Agent interest | Its terminal on its original source | Complete current pane list omits the terminal | Drop |

Offline, partial, filtered and stale observations preserve saved native IDs and
witnesses and authorize nothing. Duplicate native IDs, terminals or sessions make
a complete observation ambiguous: it attaches and ends nothing. A reused native
ID with other evidence is unconfirmed for a Board string; appearance's existing
complete-list reclamation rule still applies. Weak empty workspace/tab anchors
remain attached while their target exists and never authorize Send.

The Board JSON document remains its compatible owner representation. Opening it
captures only strings, appearance, tab colours and terminal interest into SQLite;
subsequent binding changes are serialized and drained on close. Get/patch RPCs
wait for admitted captures before replying. An unchanged capture performs no
import work, so layout edits do not create identities. Captures are paged by
bytes/count through the bounded storage queue. Interrupted imports cannot resolve
legacy targets until their World document has been reconciled. Import keys locate
legacy records and never become new World IDs. Appearance moves keep their
existing World record and binding IDs when exactly one disappearing legacy key
has the declared witnessed continuity; ambiguous candidates are never merged.

Board Send first resolves its saved string against a complete current native pane
list, then retains the existing fresh recipient/session and prompt checks. No
other host is tried. This does not make Herdr's read-then-prompt atomic or add an
exactly-once claim.

Card positions, pins, folds, and workspace/host colours remain native-keyed layout
preferences. They carry no binding and are inherited on ID reuse. The profile
JSON family and existing browser record-creation protocol remain unchanged.
Per-field claims and remaining JSON-owned ID creation are separate work. Desk
marks, watchlists and completion seen state keep their current memory lifetimes.

The [identity contract](../verification/contracts/world-identity.md) maps M4,
mutation controls and mandatory consumers. The complete `verification:gate`
checks all maintained models; a focused M4 run does not replace it. SQLite tests
use temporary databases; Herdr/OS durability and production consumer behavior
retain their separate integration and platform boundaries.
