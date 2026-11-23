## ADDED Requirements

### Requirement: Safe retirement of leftover stores

Schema 17 SHALL run after the immutable Apartments schemas 14/15 and Board
schema 16. Before any noninitial upgrade World SHALL take its existing consistent
private `VACUUM INTO` snapshot. Within one migration transaction it SHALL copy
all command-history rows to `command_changes`, preserve row order, IDs and every
body field, verify counts and rename the source `retired_ledger_changes` for one
release. Live writes SHALL use only the replacement store. CLI history, actor
filtering, conditional undo, redo compensation, regroup and undone-by bookkeeping
SHALL retain their existing behavior and 2000-row admission limit. Migration
SHALL NOT trim existing rows or permanent ID reservations.

Import markers SHALL move to JSON `meta` rows without changing names, hashes or
completion times. Pending profile assignments and ordered imported connections
SHALL persist in `meta` without changing profile behavior. The old `imports`,
`profile_legacy_assignments` and `profile_imported_connections` tables SHALL be
removed. The new and retained stores SHALL be declared in the storage catalog.

Before removing a nonempty `retired_completion_reviews` table, World SHALL
publish every row, including receipt and eligibility metadata, as private JSON
under `<data>/legacy/`. Publication SHALL never overwrite existing content;
retry SHALL verify identical bytes. An export or migration failure SHALL abort
the transaction and name the pre-upgrade snapshot. Legacy files and exports
SHALL NOT be automatically deleted. Rollback requires stopping World and restoring
the named snapshot. Board, profiles, asks, Apartments and all other retained
records SHALL keep their semantic content.

#### Scenario: Populated leftover tables upgrade
- **WHEN** a synthetic real-shaped schema 13, 14, 15 or 16 folder starts
- **THEN** every protected semantic count and hash remains identical
- **AND** command history and pending profile metadata remain usable while the old table names disappear
- **AND** every retired review row is preserved privately, regardless of its age

#### Scenario: Export or transaction fails
- **WHEN** export cannot be published or a later migration step fails
- **THEN** the original schema and rows remain intact and the error names the consistent snapshot
- **AND** retry preserves existing export files and completes without duplication

## MODIFIED Requirements

### Requirement: Durable terminal marks

Desk review marks/recent opens and watchlist SHALL use bounded
World-ID rows paired atomically with verified bindings in the single SQLite writer.
Their current wire projections and shared change notices SHALL publish only after
COMMIT and after captured runtime currency is rechecked. Restart captures SHALL
remain unresolved until current complete unambiguous original-source evidence
attaches them under each kind's declared lifetime. No runtime generation or service
incarnation SHALL be stored as durable identity. A refused row operation SHALL NOT
roll back neighboring accepted operations; close SHALL drain admitted writes.

There is no current file-owned or browser-owned state to import. The first upgrade
SHALL start empty rather than inventing continuity for old process memory or
obsolete browser keys. Subsequent starts SHALL retain committed rows and World IDs.
Board layout and ordinary Town placement SHALL NOT enter this family.
Publication SHALL merge against the latest live state without restoring another
connection's retired projection or decreasing its notice revisions. Pending agent
commands SHALL be fenced by observed ownership even when session identity is
unknown or omitted. Exact saved-watch removal SHALL remain available while its
source is unavailable and SHALL NOT delete a replacement record.

#### Scenario: Restart after acknowledgement
- **WHEN** a process dies after acknowledging a terminal mark
- **THEN** SQLite retains its complete record and binding
- **AND** it reappears only after fresh identity verification

#### Scenario: Runtime retires while storage replies
- **WHEN** a mark commits but its captured runtime retires before publication
- **THEN** the old projection is not published and the saved binding must be
  freshly verified before it appears in another runtime

Desk stop identity SHALL survive the 12-hour display expiry independently of a
review/open timestamp. Fresh initial stopped observations SHALL acquire identity
without an invented historical time. Current stop captures SHALL be protected
from history eviction; inactive/ended history SHALL retain at most 500 rows,
oldest-first, and may yield earlier to the 768 KiB serialized Desk-row budget.
Known-session captures recovering after World restart SHALL remain unresolved
and protected until complete source classification or confirmed unavailability.
Unknown-session captures SHALL require process-local live ownership to project;
terminal-only evidence SHALL NOT carry a Desk review through World/runtime
restart or null-to-known ownership. Distinct current captures MAY coexist with
unassociated historical captures for the same terminal, using separate World IDs
and original bindings. No durable runtime/incarnation identity SHALL be invented.
Capacity refusals SHALL preserve every current capture, publish no partial
projection, acknowledge no failed mutation and keep the service available.
Historical schema 10 SHALL retire the old completion row kind and verbs while
preserving original Desk/watch rows and bindings. Historical receipts SHALL be
preserved without count eviction, subject to a fail-closed 64 MiB serialized-row
budget. Schema 17 SHALL privately export every retained receipt before dropping
its archive table. Exported receipts SHALL NOT confer live Desk review state,
expire automatically or be pruned on runtime observations. Current Desk review
and exact Undo SHALL remain unchanged. The existing 1 MiB frame ceiling SHALL NOT
increase.

Re-entering source recovery SHALL protect known captures again before history
trimming, even after prior successful observation. Admitting unknown ownership
SHALL durably end preceding known Desk captures before a later restart can
restore them; their acknowledgements SHALL remain ended, unassociated history.
Capacity admission SHALL validate the complete resulting canonical writer state
before the first row operation, including commit-time width and shrinking/growing
write order. A capacity-refused observation SHALL leave durable current rows and
the published projection unchanged. Malformed native identifiers SHALL refuse
the entire observation nonfatally before any row operation or absence proof;
filtering malformed rows SHALL NOT make a partial listing authoritative.
