## MODIFIED Requirements

### Requirement: Idempotent private JSON migration

World SHALL import the configured legacy ledger at most once. Before importing,
World SHALL preserve an exact private backup named by content hash. Import of
missing IDs and its completion marker SHALL be atomic; after the marker commits,
World SHALL NOT read the ledger JSON again, even when its content changes.
Existing SQLite rows SHALL take precedence. Invalid legacy input SHALL remain
untouched and be reported while the current store starts; repaired input MAY
import on a later start while no import has completed. Historical import SHALL
create no notification sends.
After a family's import is recorded, World SHALL move its legacy JSON (Board,
ledger, agent profiles) and that file's backup copies into `<data>/legacy/` by
hard link, verified as the same file before the old name is removed. World
SHALL NOT delete them; a name used by other content SHALL receive a numbered
suffix; a file already inside `<data>/legacy/` SHALL stay there; and a failed
discovery or move SHALL leave the file in place without blocking startup.
Future schema upgrades SHALL take a private consistent SQLite backup first and
reject a foreign application ID. The three most recently written schema
snapshots SHALL stay
beside the database; older snapshots SHALL move to `<data>/legacy/` and SHALL
NOT be deleted automatically. Configuration and secrets SHALL remain files.

#### Scenario: Board elements upgrade alongside Apartments
- **WHEN** a database upgrades from the pre-Apartments release (schema 13) or
  main's Apartments schemas (14 or 15)
- **THEN** Apartments keep versions 14 and 15, Board elements use version 16,
  and existing records remain intact
- **AND WHEN** an early Board preview stamped schema 14 with `board_elements`
  but without `apartment_residents`
- **THEN** the backed-up upgrade transaction adds both Apartments migrations,
  preserves the existing Board element rows and advances to the current schema
- **AND** a failed upgrade rolls back that recovery and remains safe to retry

#### Scenario: Legacy JSON remains after import
- **WHEN** startup follows a completed import
- **THEN** it uses SQLite, performs no import writes, creates no historical alerts,
  and the legacy JSON and its backup copies sit in `<data>/legacy/`

#### Scenario: An older binary rewrites the ledger JSON
- **WHEN** a ledger JSON appears again after its import completed
- **THEN** World does not import it and moves it to `<data>/legacy/` under a
  numbered name beside the earlier copy

#### Scenario: An older binary opens a folder whose legacy files moved
- **WHEN** an older World starts after the legacy files moved
- **THEN** it finds no legacy file, makes no import writes and keeps the SQLite state
