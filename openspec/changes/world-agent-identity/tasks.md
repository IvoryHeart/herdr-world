## 1. Design (this change)

- [x] 1.1 Proposal, design, spec deltas and the [evidence](evidence.md) census.
- [x] 1.2 Design-stage Quint model [`agent-identity.qnt`](../../../quint/agent-identity.qnt)
  (now maintained in `quint/`, task 5.1), with
  the tooling locked by `bun run verification:setup`
  (`Q=tools/quint/node_modules/@informalsystems/quint/dist/src/cli.js`):
  - `node $Q test agent-identity.qnt`: 7 scenarios pass. They cover a World
    restart, a new conversation, World resume after a runtime restart, a resume by
    hand that is offered and then confirmed, a duplicate listing, one
    conversation in two terminals, and an empty conversation ending on close.
  - `node $Q run agent-identity.qnt --invariant safety --max-samples 200000 --max-steps 30 --seed 7 --backend=rust`:
    no violation.
  - Control: with `BROKEN = true` (a by-hand resume re-binds the away agent),
    the same run finds a violation, and the "offered, not merged" scenario fails.

Each later step is one PR of about 300 changed lines or fewer, excluding tests.

## 2. Conversation reader

- [ ] 2.1 Codex reader: list the thread lock a process holds (local `/proc` fds;
  over SSH, the same read), drop sub-agent threads, and classify the result as
  empty or known. Its home comes from the lock path.
- [ ] 2.2 Herdr TUI foreground process via `herdr pane process-info`. Reuse the
  Claude record reader and the start-time fence on both runtimes.
- [ ] 2.3 Conversation claim with state, source and reason, under per-field claims.
  Re-read on runtime change, and otherwise at most every 5 s per process.
- [ ] 2.4 Isolated-session check of Codex `/new` and `/resume`, Claude `/clear`,
  and macOS `lsof`/`ps`, using scratch harness homes. Record the checked harness
  versions beside the readers.

## 3. Agent store

- [x] 3.1 Migration that adds `entities` and `facts` (agent kind only; `facts` indexed
  by `(field, item)`), with catalog entries giving owner, identity and limit, and each
  field's owner declared once with `declareData`. No other table: conversation history
  is a multi-valued fact keyed `<harness>/<conversation ID>` ([storage](storage.md)).
- [x] 3.2 Agent store operations: create, set label, append conversation, set
  fact, end. Never trim. Only the command executor and the resolver call them;
  only commands record history.

## 4. Agent resolver

- [x] 4.1 Declare the agent `seat` binding under verified source bindings:
  witnessed terminal, World move or resume result, user confirmation.
- [x] 4.2 Live, away, unresolved and ended states, newcomer admission, and
  "Same agent?" offers. Ambiguity, duplicate and conflict rules.

## 5. Maintained model

- [x] 5.1 Move `agent-identity.qnt` into `quint/`, write its adapter over the
  task-4 resolver, add a coverage entry, and run the full verification gate.

## 6. Snapshot

- [x] 6.1 `agents` and `agent_id` on terminal rows under one revision, in the
  World snapshot and its API types. Each later step adds its field (colour, look,
  status text, placement, groups, interest, profile). Extend
  `server/src/world/world-cross-view.test.ts` with `agent_id`, state and name.

## 7. Migration of facts

- [x] 7.1 Stop `appearance.prune` from deleting appearance rows, and `tabClosedOps`
  from deleting a closed tab's colour and desk pin. Each row moves to the closed key
  `["closed", <revision>, <key>]` in its own table, outside the layout and appearance
  limits and hidden from views; desk pins close under a `desk-pin` policy like
  `tab-colour`. Ships before any copy.
- [ ] 7.2 Place entities for host, room and tab, bound by the `place` policy of
  [design §4](design.md#4-storage-and-migration) (a core room by its `herdr-app`
  space ID and the core's durable ID); copy `board_colors`, room spots
  and tab colours of tabs without a single agent onto them.
- [ ] 7.3 Copy tab colour, status text, avatar, desk pin and rank, Board card
  placement, interest, groups, profile assignment and Town Master onto agents
  when the key is unique. Leave other rows pending.
- [ ] 7.4 Add `agent_id` to Desk marks, residents and per-agent rows of
  `usage-activity.json`, add the verify-then-retire
  check (per table; any pending row keeps the table and its reader), and record
  the rollback snapshot.

- [ ] 7.5 Apartments: once task 2 records every session as a `conversation` item,
  Apartments reads past sessions from agent records and stops writing
  `apartment_residents`. Residents whose session is in an agent's history count as
  copied; pre-agent residents stay and keep displaying, so the table retires only
  if none is pending.

## 8. One record in every view

- [ ] 8.1 One shared colour and look resolver over agent and place records (own,
  tab place, inherited, room, room default; a chosen colour beats inheritance), used
  by the service, Town (replacing `townAppearance`'s own derivation), Board,
  Spaces and Apartments.
- [ ] 8.2 Agent operations `agent.set` and `agent.place`; the colour, look and
  status pickers in every view, `herdr-world colour` and `board card colour`
  write through them. Rename writes the record, then the runtime's name, and an
  observed runtime rename updates the record.
- [ ] 8.3 Town desks and Desk records keyed by `agent_id`.
- [ ] 8.4 Board agent cards keyed by `agent_id`; Board host zones follow the Group
  runtimes setting (#1307) through its shared derivation. Cross-view test: one
  snapshot, Town, Desk, Board and the CLI, the same values per agent.

## 9. User choices

- [ ] 9.1 "Same agent as …?" offer and confirmation; End.
- [ ] 9.2 "Resume agents" after a runtime restart. Chat's manual link becomes the
  fallback source. Update the capability notes and help.
