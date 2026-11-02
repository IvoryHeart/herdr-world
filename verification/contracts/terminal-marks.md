# Durable terminal marks

Owner approval: `briefs/persist-marks.md` changes the former restart-clears rule.
Current contracts: World storage, World identity and World surfaces. Q51 is
candidate direct evidence; independent review and native CI remain required.

Allowed: store-issued record IDs and source bindings commit with bounded metadata
in the existing SQLite worker. Restart captures remain unresolved until a fresh,
complete, unambiguous observation of the original source verifies them. Runtime
generation and service incarnation qualify work and projections, never durable
identity. Watchlist follows the terminal; Desk requires its captured known session. Unknown-session Desk captures require live
process ownership; terminal-only evidence cannot restore their review after
World/runtime restart, null-to-known ownership or a returning known fingerprint
after an intervening owner. Old acknowledgements stay unassociated in history.
Complete current terminal absence clears each kind. Positive known-session
replacement ends Desk captures as non-reattachable history while watchlist survives. Native completion progress names a new Desk stop. Exact Undo retains a newer review mark.
Publication merges the operation's connection into the latest live projection;
another connection's retirement and every published revision remain monotonic.
Pending Desk commands capture an ownership token even for unknown or
omitted request fingerprints. Observed replacement invalidates it permanently,
including a return to the original session. Terminal-scoped watch admission does
not inherit this agent-session restriction.

Unpin names the saved World record with `watch_id`, independently of projection
membership or source availability. It can remove an unresolved restart capture,
releases the 128-watch capacity, and never removes a newer replacement record.
If that same record reattaches in a newer generation, exact Unpin removes its
current projection before replying and invalidates the generation removed.
The reply, list and shared clients therefore agree immediately after the commit.
Legacy runtime-qualified tuples are accepted only while their remembered capture
is unambiguous in this service; reuse requires the returned ID. Ownership tokens
and legacy aliases are bounded process memory (8,192 and 4,096 entries), never
persistent runtime identity.

Forbidden: attaching duplicate pane, terminal or session evidence; inferring
continuity from names, paths or reused pane IDs; publication before commit;
publishing an old projection after runtime retirement; losing a neighboring
accepted transaction to a refused mutation; persisting runtime fences or transcript
text; adopting browser-local IDs without continuity evidence; duplicating Board
layout ownership.

Evidence uses actual temporary SQLite, the worker and production RPC handlers.
`storage/terminal-marks.test.ts` checks stable IDs, unresolved restart capture and
storage integrity, all 6 independent-family/refusal orders and revision fences. `world/persistent-terminal-marks.test.ts` exercises all three
identity ambiguities, complete absence/reuse, terminal moves, positive session
replacement, unknown session, missed native progress, two real browser stores
per active family, exact Undo, refused writes, retirement during acknowledgement and native admission across a replaced
then restored session. The 40-open bound spans sources and equal-time actions. Display expiry commits without a source read;
expiry/Unpin replies and background writes cannot cross a disconnect and restore
an old projection. Cross-connection disconnect/replacement tests hold a real
SQLite acknowledgement while another host retires, including global recency
trimming, and check increasing notice revisions. Unknown and known Desk fingerprints are exercised through their real RPC handlers. Saved
Unpin tests cover disconnection, restart before verification, capacity release,
same/new-generation replacement, same-ID reattachment in a newer generation,
reply/list/two-client agreement, current-generation invalidation and exact browser
capture forwarding.
`service/terminal-marks.test.ts` checks the composition root, two real WebSockets,
change notices and restart against the same database. `storage/terminal-marks-crash.test.ts`
uses source and standalone compiled processes, killed before commit, after commit
and after worker acknowledgement; admitted writes also drain on close. It checks
complete record/binding pairs and integrity. Native installer CI includes these
eight cases. Eleven compiled production faults fail thirteen named boundary assertions; two
positive bundled suites establish the harness. Existing binding, Desk, watchlist and browser consumers
remain mandatory.

Direct finite transitions, real SQL savepoints and process schedules provide
evidence at the actual persistence boundary; a new model of SQL would duplicate
those rules without exercising SQLite. The existing binding and runtime models
remain required, with the new per-kind declarations checked directly. Run the
unfiltered `bun run verification:gate`; a focused model case does not replace it.

Migration has no current file or browser owner to import: the old service's
process memory is gone on upgrade, and historical browser keys lack binding
evidence. The first upgrade therefore starts these families empty. Board's
existing layout migration belongs to its separate owner.

Excluded: physical power loss, arbitrary storage corruption, all possible remote
read schedules, replay of source events, exactly-once external effects and
persisted runtime claims. A source without native progress cannot reveal a
working/completion cycle World never observed. Multi-record observation repair
uses bounded independent row transactions; a crash may retain a committed prefix,
which is freshly re-resolved after restart. A user mutation acknowledges only
after all its resulting row writes finish. Browser/native CI and independent
consumer-mapping acceptance remain separate from local evidence.

## Current stop coverage and retention

Properties precede mapping: every fresh admitted stopped agent has a current
stop even on first observation/startup/new connection/runtime generation; no
historical transition/time is invented. Every Town completion, including the
blocked-to-idle inferred finish, can address a Desk review. Expiring display time
never deletes a current stop merely because it has not yet been reviewed/opened.
Current source/session captures are never evicted to make room for history.
Inactive/ended history has a 500-row oldest-first limit; known-session recovery
captures remain unresolved/protected until fresh classification or confirmed
source unavailability. Serial Desk projection/SQLite state is bounded to 768 KiB,
with labelled refusals and no increase to the existing 1 MiB frame ceiling.

`world/review-stop-coverage.test.ts` uses real SQLite worker/RPC and two actual
browser stores: initial done/idle/blocked, aged unreviewed/reviewed restart,
known-session restoration, native successor, repeated review, null restart,
null-to-known, known replacement and returning-known-after-unknown no-carry,
550 current stops plus 500 oldest-first history, and byte-budget refusal without
current eviction or acknowledgement. Existing deferred admission/commit,
no-session ownership, retirement/replacement, crash and consumer tests remain
mandatory. Compiled production controls remove initial capture, stable-ID
retention or unknown continuity fences and require the corresponding regression
to fail; existing session/publication/Undo/storage fault controls remain active.

`world/review-stop-scale.test.ts` measures the maintained scale inputs. The
10-source row has 360 current stops: 104,161 bytes on the Desk wire and 179,761
acknowledged-list bytes. Canonical writer/restart accounting is 180,481 bytes
(about 289 wire / 501 canonical SQLite bytes per record); attached memory rows
use 179,761 bytes (about 499 per record). The dense-repair row
contains 2,191,232 native panes across 64 sources; its first source's 34,238 panes
produce a 13,639,096-byte native response and the real HerdrClient refuses it as
`Herdr response line is too large` before any Desk capture. Desk row count is 0,
wire state 27 bytes and SQLite list 2 bytes. This is native-admission refusal
evidence, not composed-service/browser dense success or total native coverage.
Both cases retain the unchanged 1 MiB ceiling. Direct finite consumer/storage
and compiled fault tests exercise these identity and persistence boundaries;
a second model of SQL would not establish the actual worker/SQLite behavior.
Run the complete unfiltered `bun run verification:gate` and required consumers.

The compatible Chat rebuild and Part 1 stop coverage have merged. Schema 10
retires the operational completion row kind, RPC verbs, binding declaration,
notice and browser fallback. Desk/watch remain the active row family. The supported native schema has no checkable runtime-instance
signal, so null-session review continuity through restart remains excluded.

## Review repair: recovery, replacement, atomic refusal and malformed ingress

`world/review-stop-review.test.ts` adds seven real-consumer cases: 501 known stops
survive re-entry to recovery; unknown ownership durably ends the preceding known
capture before World restart; a writer budget filled exactly to 786,432 bytes
refuses a two-stop advance without changing any durable current row; a near-full
plan shrinks current rows before growth; malformed native identity is refused
on the actual snapshot-to-persistence path without fatal callback or false
absence; a retired runtime cannot poison the current projection with an invalid
observation; and an older unknown listing cannot end a newer accepted review. Four compiled faults restore each reviewed defect and
must fail its regression. This extends the finite direct evidence, not native
runtime-instance proof.

Storage admission and preflight share canonical unresolved-binding byte counts.
A changed binding reserves the remaining width of a JSON number (at most 24
bytes) for the worker's later checked_at; provisional new IDs overestimate the
issued ID width. Unchanged rows retain exact accounting. Shrinking writes run
before growing writes and open-recency trimming precedes the writer's capacity
check, preventing an intermediate state from exceeding the validated plan.
Crash/storage-fault prefix evidence remains distinct from atomic capacity
refusal. Native listing validation uses the same binding writer validator and
Desk identity bounds, rejects the complete listing rather than filtering it,
and never converts arbitrary storage failures into benign input refusals.

## Draining legacy-review archive

Properties: one atomic/idempotent schema-9 upgrade preserves original Desk/watch
rows, bindings, IDs, row order, revisions and open recency byte-for-byte. Original
migration 9 remains historical. Legacy receipts leave the operational family and
binding APIs; their original metadata enters a private archive with no public
verb, UI or Desk/wire projection. Retention is newest 4,096 receipts, oldest-first
on overflow, with its own 64 MiB canonical serialized-row budget. An excessive
archive refuses upgrade with a labelled error and leaves schema 9 intact.
No new receipt is inserted after migration. Resolution, fresh complete original
source terminal absence, or 30 days after the original migration drains it;
offline sources do not extend the deadline. A later release removes the table.

Resolution requires a fresh complete unambiguous observation after migration:
same connection ID, terminal, known session and unchanged native state-change
sequence. Activity uses the same pane/matched-agent normalization as the World
leaf, so the canonical stop shape remains `stop:[observed_stop_id,activity]`.
There is no synthetic transition time. Unknown legacy sessions never resolve;
missing sequence defers. Positive replacement, unknown ownership, changed
sequence or busy status disqualifies the receipt permanently, including return
to the former proof after restart. Review plus receipt deletion share one SQLite
savepoint/acknowledgement; binding or capacity refusal rolls both back. Existing
newer Desk review and explicit Undo win. Current/history/queue/frame bounds stay
independent and unchanged; archive proof batches contain at most 32 targets.

Mapping: `storage/legacy-reviews.test.ts` exercises historical schema 9, exact
preservation, rollback, idempotence, count/byte limits, archive expiry and refused
atomic resolution. `world/legacy-review-resolution.test.ts` runs production
admission, actual SQLite worker/RPC and two browser stores through known carry,
unknown/no-sequence no-carry, null-to-known, replacement and return, changed or
missing native sequence, ambiguity, original-source absence, newer review/Undo,
scheduled offline expiry and retirement during acknowledgement. A crash between
archive proof and Desk checkpoint cannot forget disqualification. Three added
compiled worker faults remove session, sequence and expiry fences and must fail
those named assertions; a positive archive bundle validates the harness.
`rpc/review-retirement.test.ts` checks retired methods are unregistered and receive
the existing unknown-method refusal. Browser helper/Needs you/Town consumers
exercise authoritative Desk refresh, exact shown-stop review and retry without
terminal-only or last-activity-only success. Existing service/two-WebSocket,
source/standalone crash, stop coverage/resource and mandatory ordering consumers
remain required. Direct real-SQLite/finite consumers exercise these properties;
a duplicate SQL model would not strengthen the actual transaction boundary.
No native runtime-instance proof, null-session restart continuity, physical
power-loss or dense composed success is claimed.

## Review repair: deadline and actual World activity

The original archive deadline is enforced again inside the resolving Desk
savepoint with its injected writer timestamp. An earlier admitted proof cannot
confer review at or after expiry; restart never extends that deadline. Expiry and
receipt resolution remain atomic with the Desk operation.

Display metadata matching and activity normalization are shared with the actual
World leaf. Identity, status and native sequence admission keep their stricter
unique current-session proof. If those two activity views disagree (including
sparse-session, duplicate, missing-terminal or obsolete-session metadata),
conversion defers and retains the receipt; a later safe matching observation can
resolve it. Native pane activity can still establish the exact token despite
ambiguous metadata. The canonical stop string shape stays unchanged.

`world/legacy-review-boundaries.test.ts` covers just before, exactly at and after
the deadline, with and without restart, plus actual `buildWorldObject` consumers
for metadata disagreement and later valid transfer. Two compiled faults remove
the resolving expiry check or falsely attest matching activity and must fail
the named boundary regressions. Existing replacement/no-carry/sequence fences,
real-SQLite rollback, all maintained models and native CI remain required.
