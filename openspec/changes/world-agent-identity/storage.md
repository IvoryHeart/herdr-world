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
| `facts` | each entity's fields, one row per field and item, with its owner | 4 KiB per value; never trimmed |

## Folded into `entities` and `facts`, then retired

| Table today | Becomes | Copied and retired by |
| --- | --- | --- |
| `board_colors` | agent `colour`; host, room and tab `place` colour | step 3, colour and look (last), with tasks 7.2 and 7.3 |
| `board_appearance` | agent `look` and `status_text`; tab place status | step 3, with task 7.3 |
| `board_desk_pins` | agent `town.pin` and rank | step 6, pins (pin) and step 9 (rank) |
| `board_room_pins` | room place `town.spot` | step 9, placement and order, with task 7.2 |
| `board_anchors`, `board_offsets`, `board_folded` | agent or note `board.place`, `board.folded` | step 9 |
| `board_pinned` | the one pin per entity | step 6 |
| `board_interest`, `board_group_interest` | agent and group `interest` | step 8, interest, relations and groups |
| `board_groups`, `board_spawns` | `crew` entities with `member` items; agent `spawned_by` | step 8 |
| `board_group_changes` | history entries in `ledger_changes` | step 8 |
| `profile_legacy_assignments`, `profile_imported_connections` | agent `profile` (finishes the import) | step 12, profiles and Town Master |
| `board_meta` | nothing: the World revision | step 14, once no `board_*` table is live |

## Gain an agent reference, stay as records

| Table | Change | When |
| --- | --- | --- |
| `terminal_marks` | Desk marks and watchlist gain `agent_id`, keep their lifetimes | task 7.4 |
| `apartment_residents`, `apartment_evictions` | residents gain `agent_id`; folding them into conversation items is a later Apartments step, not scheduled | task 7.4 |
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
| `core_topology` | World is herdr-core's source for rooms and tabs; its rooms become `place` entities with task 7.2, retirement not scheduled |

Count: 43 tables today, 45 after this change, and 29 once steps 3, 6, 8, 9, 12 and
14 retire the 16 tables in the folded list.
