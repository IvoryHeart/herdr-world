## MODIFIED Requirements

### Requirement: Idempotent private JSON migration

Before importing a changed configured legacy ledger, World SHALL preserve an
exact private backup named by content hash. Import of missing IDs and its hash
marker SHALL be atomic; unchanged second startup SHALL make no import writes.
Existing SQLite rows SHALL take precedence. Invalid legacy input SHALL remain
untouched and be reported while the current store starts; repaired input MAY
import on a later start. Historical import SHALL create no notification sends.
Future schema upgrades SHALL take a private consistent SQLite backup first and
reject a foreign application ID. Configuration and secrets SHALL remain files.

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
- **THEN** it uses SQLite, performs no import writes for unchanged legacy input,
  and creates no historical alerts

### Requirement: Durable Board concerns with compatible revisions and bindings

World SHALL store Board notes, strings, drawings, registered element references,
appearance, layout concerns, interest and relations in separate SQLite tables through the instance's single asynchronous
writer. Board patches SHALL remain all-or-none, retain existing document and
per-note/Group conflict wire behavior, and commit identity captures with their
records. Only acknowledged commits SHALL advance synchronous reads, replies or
revision events. Independent edits SHALL use fresh transaction-local state;
unchanged rows SHALL retain their row revision. Queued planning SHALL recheck
captured runtime authority. Conditional undo SHALL NOT overwrite newer admitted
edits, and native-move reconciliation SHALL preserve concurrent explicit fields.
Existing identity binding policies SHALL remain unchanged. Layout positions,
pins, folds and workspace/host colours SHALL remain native-keyed preferences.
Runtime claims SHALL remain in memory. Existing valid Board document and patch
capacity, including multibyte text, SHALL fit the bounded storage admission port.
Queued plans SHALL reserve their retained payload bytes before entering the
queue, including client RPC parameters. Wrappers SHALL preserve reservations,
and every completion, refusal or skipped plan SHALL release its reservation.
Validation and runtime-authority rechecks SHALL still use acknowledged state
when planning runs.
Snapshot-driven metadata plans SHALL project only their consumer's observation
inputs before reservation. Dense aggregate labels or agent metadata SHALL NOT
prevent a small relationship or legacy appearance update. Projections SHALL
preserve completeness, captured generation and current-runtime authority checks,
and reconciliation SHALL still use acknowledged Board state when its plan runs.

Before its initial import, World SHALL preserve exact private content-hash backup
bytes of the configured Board JSON. Concern rows, ID reservations, bindings and
the completion marker SHALL commit atomically before the listener starts. Missing
JSON SHALL initialize empty state once. Malformed initial JSON or an unsafe or
conflicting backup SHALL stop startup without partial Board data and leave the
source intact. After initialization, SQLite SHALL take precedence over all
retained JSON versions without reimport or source writes. Existing note, string
and Group IDs SHALL survive import and remain reserved against generated reuse.
Close SHALL drain admitted Board writes, refuse later writes and retain committed
cached reads without reopening storage. Configuration and secrets remain files.

#### Scenario: Independent note edits and a stale draft
- **WHEN** independent notes are edited while another writer submits a stale note revision
- **THEN** both independent edits commit and the stale draft receives the current document
- **AND** its refused patch changes no concern rows or bindings

#### Scenario: An edit is queued during native move reconciliation
- **WHEN** an explicit appearance edit is admitted before a move's Board follow-up commits
- **THEN** reconciliation rechecks its Board revision and preserves the explicit fields
- **AND** no retired runtime can authorize queued metadata changes

#### Scenario: Initial Board import or edit is interrupted
- **WHEN** the process is killed before or after COMMIT
- **THEN** recovery contains all affected records and bindings or none of them
- **AND** import retry completes once without restoring later-deleted records or modifying the source
