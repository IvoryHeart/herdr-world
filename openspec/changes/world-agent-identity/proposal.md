## Why

Moving agents between runtimes failed (#1184, parked) because World has no
agent. A desk is keyed by its runtime address, so a move or a rename makes a new
desk, and facts are copied across by hand (`agent.rehome`). In one try,
two desks were both called "reviewer-3-2-2". World also knew no conversation for
most Codex agents, so every move started fresh.

The harness already knows the conversation. Claude Code writes it per process, and
Codex holds a lock file named after it for as long as the thread lives
([evidence](evidence.md)). World should read that, not ask.

## What Changes

- **One World agent.** Each Claude Code or Codex occupant World observes gets an
  agent ID (`a-` plus eight symbols). Its name is a label. Its place is a
  binding to a terminal through the existing resolver. It survives renames, room and
  desk moves, World restarts, and moves and resumes that World itself performs. It
  ends only when the user ends it, or when it has no terminal and nothing to resume.
- **Same agent or not** is decided by evidence only: the witnessed terminal, World's
  own move or resume result, or the user's choice. A conversation resumed outside
  World is offered as "same agent?", never merged silently. Ambiguous evidence
  binds nothing.
- **A conversation for every agent**, read from the harness's own per-process record
  on Herdr TUI and herdr-core alike: Claude's `sessions/<pid>.json`, and Codex's held
  `thread-writer-locks/<thread-id>.lock`. It is known, empty, unknown (with the
  reason) or in conflict, and it stays current when the agent starts a new
  conversation. Manual linking in Chat becomes a fallback.
- **Facts on the agent.** Desk pin, colour, group membership, interest, profile
  assignment and Town Master move onto the agent ID through a copying, lossless
  migration. Old rows stay until the copy is verified.
- **One agent record for every view.** The snapshot carries the agents and each
  terminal's `agent_id`; Town, Desk and Board select by it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-identity`: the agent entity, its seat binding and same-agent rules, the
  conversation claim, and one agent record for every view.
- `world-storage`: agent records, their conversation history, and the migration of
  today's agent facts onto agent IDs.

## Impact

This change is the design only; it changes no code, schema or data. It refines the
`world-single-model` target, in which a session was the entity: here the durable
entity is the agent, and a conversation is a claim and a history row. Implementation
follows the steps in [tasks](tasks.md). Agent moves (#1184) build on it later and are
out of scope. Spaces' browser pins and usage stay with their own single-model steps.

This proposal asks for storage approval: the agent becomes the first
kind in the single-model plan's `entities` and `facts` tables, and one new table,
`agent_conversations`, holds each agent's conversation history (see design).
