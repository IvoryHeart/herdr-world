## 1. Design (this change)

- [x] 1.1 Proposal, design, spec deltas and the [evidence](evidence.md) census.
- [x] 1.2 Design-stage Quint model [`agent-identity.qnt`](agent-identity.qnt), with
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

- [ ] 3.1 Migration that adds `entities`, `facts` and `agent_conversations` (agent
  kind only), with catalog entries giving owner, identity and limit.
- [ ] 3.2 Agent store operations: create, set label, append conversation, set
  fact, end. Never trim.

## 4. Agent resolver

- [ ] 4.1 Declare the agent `seat` binding under verified source bindings:
  witnessed terminal, World move or resume result, user confirmation.
- [ ] 4.2 Live, away, unresolved and ended states, newcomer admission, and
  "Same agent?" offers. Ambiguity, duplicate and conflict rules.

## 5. Maintained model

- [ ] 5.1 Move `agent-identity.qnt` into `quint/`, write its adapter over the
  task-4 resolver, add a coverage entry, and run the full verification gate.

## 6. Snapshot

- [ ] 6.1 `agents` and `agent_id` on terminal rows under one revision, in the
  World snapshot and its API types.

## 7. Migration of facts

- [ ] 7.1 Copy appearance, colours, desk pins and ranks, interest, groups, profile
  assignment and Town Master when the key is unique. Leave other rows pending.
- [ ] 7.2 Add `agent_id` to Desk marks and residents, add the verify-then-retire
  check, and record the rollback snapshot.

## 8. Views

- [ ] 8.1 Town desks and Desk records keyed by `agent_id`.
- [ ] 8.2 Board agent cards keyed by `agent_id`. Cross-view test: one snapshot,
  three projections, the same values per agent.

## 9. User choices

- [ ] 9.1 "Same agent as …?" offer and confirmation; End.
- [ ] 9.2 "Resume agents" after a runtime restart. Chat's manual link becomes the
  fallback source. Update the capability notes and help.
