## Why

Issue #1172 asks that an agent's desk move between Herdr TUI and herdr-core
on the same machine, in Town and on Board, keeping its pin, colour and links.
The two runtimes have no shared native move, so World hands the agent over:
it resumes the agent's conversation on the destination and closes the
original. Relations so far never crossed connections; a moved agent's spawn
link now does.

## What Changes

- A new service request, `world.agent.move`, qualified by both connections'
  IDs and runtime generations, moves one idle Claude or Codex agent to a room
  of another runtime on the same machine. Moves within one runtime keep using
  that runtime's own move.
- The handoff resumes on the destination, waits until it is ready, checks the
  original again, carries the desk over, then closes the original. It
  reports a refusal, or an uncertain outcome when an end was asked but not
  confirmed.
- A new Board operation, `agent.rehome`, moves a desk's saved layout, colour,
  pin, appearance, strings and spawn links to the new address; a spawn claim
  keeps the superseded parents in `moved_from`.
- A spawn link kept by a move may cross connections, and the moved desk
  keeps the colour it inherited.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: agent moves between runtimes; agent relations kept
  across connections by an explicit move.

## Impact

Service: `server/src/world/agent-move.ts`, `server/src/world/agent-rehome.ts`,
`server/src/rpc/agent-move.ts`, `server/src/world/board-*.ts`,
`shared/agentMove.ts`, `shared/relations.ts`. Browser: Town drag and M menu,
Town and Board peeks. Evidence: `server/src/world/agent-move.test.ts`,
`verification/contracts/agent-move-audit.md` (Q57). Docs: FEATURES.md.
