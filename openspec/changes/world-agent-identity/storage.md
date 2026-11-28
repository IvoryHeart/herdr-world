# Storage inventory: `world.sqlite` before and after

Read on 2026-11-28 from `server/src/storage/catalog.ts`. The agent record adds two
tables, `entities` and `facts` ([design](design.md#4-storage-and-migration)). No
other table or data file is added; the earlier `agent_conversations` table is
dropped because a multi-valued fact holds the conversation history.

"World-as-one step" names a section of
[`world-one-object/tasks.md`](../world-one-object/tasks.md). A table that folds in is
copied by that step under this change's rules (copy only a unique key, leave the rest
pending), and is renamed `retired_*` only after a check shows every row copied and
none pending. A retired table is kept one release and never deleted automatically.

## Added by this change

| Table | Holds | Limit |
| --- | --- | --- |
| `entities` | one row per agent (later: place, note, crew, conversation) | none: never trimmed |
| `facts` | each entity's fields, one row per field and item; indexed by `(field, item)`; each field's owner is declared once in the catalog, not per row | 4 KiB per value; never trimmed |

## Folded into `entities` and `facts`, then retired

| Table today | Becomes | Copied and retired by |
| --- | --- | --- |
| `board_colors` | agent `colour`; host, room and tab `place` colour | step 3, colour and look (last), with tasks 7.2 and 7.3 |
| `board_appearance` | agent `look` and `status_text`; tab place status | step 3, with task 7.3 |
| `board_desk_pins` | the entity's one `pin` and its `town.rank` (no second pin field) | step 6, pins (pin) and step 9 (rank) |
| `board_room_pins` | room place `town.spot` | step 9, placement and order, with task 7.2 |
| `board_anchors`, `board_offsets`, `board_folded` | agent or note `board.place`, `board.folded` | step 9 |
| `board_pinned` | the one pin per entity | step 6 |
| `board_interest`, `board_group_interest` | agent and group `interest` | step 8, interest, relations and groups |
| `board_groups`, `board_spawns` | `crew` entities with `member` items; agent `spawned_by` | step 8 |
| `board_group_changes` | history entries in `ledger_changes` | step 8 |
| `profile_legacy_assignments`, `profile_imported_connections` | agent `profile` (finishes the import) | step 12, profiles and Town Master |

## Gain an agent reference, stay as records

| Table | Change | When |
| --- | --- | --- |
| `terminal_marks` | Desk marks and watchlist gain `agent_id`, keep their lifetimes | task 7.4 |
| `apartment_residents` | residents gain `agent_id` (task 7.4); then Apartments reads agent `conversation` items and stops writing the table (task 7.5). Pre-agent sessions match no agent and nothing proves which agent ran them, so they stay and keep displaying; the table retires only if the check finds none pending | tasks 7.4, 7.5 |
| `apartment_evictions` | gains `agent_id`; stays, as the user's list of sessions never to return | task 7.4 |
| `usage-activity.json` (data file) | per-agent rows gain `agent_id`; stays, keyed by agent and day | task 7.4 |
| `world_bindings` | gains the agent `seat` policy | task 4.1 (this change) |

## Stay as they are

| Table | Why |
| --- | --- |
| `asks`, `results`, `outbox`, `answer_attempts`, `effect_decisions` | records, not entity fields |
| `ledger_changes` | the history every command writes; its trim is replaced in step 13 |
| `ledger_meta`, `replay_changes`, `sqlite_sequence`, `imports`, `world_ids` | plumbing |
| `world_binding_legacy`, `world_binding_sync`, `retired_completion_reviews` | finished imports and an archive, kept until the user clears them |
| `agent_profiles`, `profile_chimes`, `profile_store_meta` | launch profiles and chime settings; an agent's profile assignment moves in step 12, the profiles do not |
| `auto_sync_runs` | run status |
| `board_notes`, `board_strings`, `board_shapes`, `board_elements` | authored Board records; not in a World-as-one step |
| `board_meta` | the Board revision and family flags; it stays while any `board_*` table above is live |
| `core_topology` | migration acknowledgement, created-ID provenance and checkout metadata only ([app layout design](../../specs/herdr-core-runtime/app-layout-design.md)); core room membership and names come from the `herdr-app` document. Its rows never become places: a core room place binds to the `herdr-app` space ID plus the core's durable ID (task 7.2), and folder-fallback groups are derived, not places |

Count: 43 tables today and 45 after this change. Steps 3, 6, 8, 9 and 12 retire the
15 tables in the folded list, leaving 30 live tables (`board_meta` stays with the
authored Board tables). Retired tables stay in the file as `retired_*` for one
release and are not counted.

Rollback: an older release refuses the newer `world.sqlite` and names its
pre-upgrade snapshot, which restores every old row; rolling back a retiring step
renames its `retired_*` tables back ([design](design.md#4-storage-and-migration)).
