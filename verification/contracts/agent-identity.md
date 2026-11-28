# World agent identity (agent-identity)

## Scope and requirement

World keeps one record per agent in `entities` and `facts`
(`server/src/storage/agent-store.ts`), seated by a `seat` binding. The
resolver (`server/src/world/agent-resolver.ts`) reads each complete pane
listing of either runtime; the agent records
(`server/src/world/agent-records.ts`) commit what it proves through World's
single writer and derive each reply's agents and terminal-row `agent_id`
under the snapshot's revision. The requirement is the `world-agent-identity`
OpenSpec change (`world-identity`, `world-storage`).

Order: a complete, current listing → ambiguous (a terminal shown twice, or an
occupant of an unlisted terminal) binds, moves and ends nothing, and every
agent seated on that connection is unresolved → otherwise a held agent whose
harness still runs in its terminal keeps its seat and takes a new
conversation in place; one whose terminal closed or changed harness leaves
(away, with its conversation) or ends (nothing to resume) → every other
occupant is a new agent; if exactly one away agent ran its conversation it is
offered as that agent, never merged → each reply derives live, away,
unresolved or ended from the stored record and the newest listing, and marks a
conversation two live agents claim as a conflict for both.

## Model and replay

`quint/agent-identity.qnt` has three agents, three terminals and two
conversations. Runtime events open and close terminals, start and exit
harnesses, change conversations and restart the runtime; World restarts,
reads partial, duplicate and complete listings, admits newcomers, resumes and
moves agents; the user confirms an offer or ends an agent. Its safety
invariant, checked after every step:

- one agent per seat;
- a seat comes only from a witness, a newcomer, World's own result or the user;
- a partial or duplicate listing binds, moves and ends nothing;
- an ended agent never returns;
- only a live agent with a known, unconflicted conversation from a complete
  listing may act, and its record is true.

Seven named runs pass: a World restart keeps the agent, a new conversation
keeps the agent, a runtime restart leaves it away and World resumes it, a
resume by hand is offered and then confirmed, a duplicate listing binds
nothing, one conversation in two terminals conflicts, and an empty
conversation ends on close. The safety invariant is checked by random
simulation of three seeds × 2,000 traces of up to 30 steps; exhaustive TLC
does not finish in ten minutes (over two million distinct states and a
growing queue). With `BROKEN = true` (a hand-started terminal running an away
agent's conversation re-binds that agent) TLC must find a counterexample,
which breadth-first search reaches in seconds.

`quint/agent-identity.ts` replays the seven scenarios through the real
`openWorldWriter` over a temporary `world.sqlite`, `createAgentsPort` and
`createAgentRecords`, over a synthetic Herdr connection whose terminals and
conversations the scenario drives. The model's `observeComplete` then `admit`
is one listing there. After every step it checks one agent per seat and that
an ended agent never returns. Three production mutants must be rejected: an
ambiguous listing still updates what replies derive, a close never ends an
agent, and two live claims are not a conflict.

## Limits

World resume, World move and the user's confirmation are modelled but not
built yet (world-agent-identity tasks 8 and 9); the runtime-restart and
resume-by-hand scenarios replay up to that step. The conversation comes only
from the runtime's session report until the task-2 readers land. herdr-core
and several connections use the same resolver and store; they are covered by
`server/src/world/world-cross-view.test.ts` and unit tests, not replay.
