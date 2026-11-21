## ADDED Requirements

### Requirement: Agent moves between runtimes

World SHALL let the user move an agent's desk to a room of another runtime of
the same machine (Herdr TUI to herdr-core or back) by dragging the desk into
that room in Town, from Town's M list, and with Move to… on the desk's Town
and Board peeks. A move within one runtime SHALL use that runtime's own move.
The request SHALL run in the World service, qualified by both connections' IDs
and runtime generations, and SHALL be refused for a retired generation,
across machines, for a harness other than Claude or Codex, for a desk with
more than one terminal, for an agent that is working or waiting for an
answer, for a herdr-core agent whose own agents would end with it, and when
World cannot find the conversation to resume. One service SHALL hand over one
agent at a time.

World SHALL start the agent's harness on the destination with its
conversation resumed and wait until it is ready. It SHALL then check the
original again: it SHALL still be the same idle agent, alone at its desk, or
World SHALL close the new copy and leave the original running. World SHALL
then carry the desk to the new address and close the original, ending only
what it admitted: a herdr-core child started since admission SHALL refuse the
close. If the original refuses to close, World SHALL put the desk back, close
the new copy and say the original still runs. When an end was asked but not
confirmed, World SHALL say which agent may still be running instead of
reporting a move or a clean refusal.

The Board operation `agent.rehome` SHALL move the desk's saved place, colour,
pin, fold, appearance, strings and spawn links from the old address to the
new one. A spawn claim whose parent moved SHALL name the new parent and keep
the old one in `moved_from`, so the child's live token naming the old parent
neither replaces nor duplicates the claim. Observations SHALL never infer a
move.

#### Scenario: Drag a desk to the other runtime

- **WHEN** the user drags an idle Claude desk from a Herdr TUI room into a herdr-core room of the same machine
- **THEN** the agent runs there with its conversation resumed, its desk keeps its pin, colour and spawn lines, and the original closes

#### Scenario: The original starts working during the handoff

- **WHEN** the original agent starts working before the new copy is ready
- **THEN** World closes the new copy, keeps the original and its desk, and says why

#### Scenario: A close that is not confirmed

- **WHEN** herdr-core does not confirm that the original ended
- **THEN** World says the agent runs in its new room and the original may still be running

## MODIFIED Requirements

### Requirement: Agent relations

World SHALL relate two terminals of one connection when either a spawn or a
manual Team says so, and SHALL show each relation with its evidence: its
source, whether it holds now and its system of record. A spawn is the child
pane's Herdr metadata token `spawned_by` (the parent pane) or
`spawned_by_terminal` (the parent terminal, which wins), which any tool may
write; Herdr is its record while the token lives, and World's saved claim,
recorded by the service only from a live snapshot of the connection's current
runtime, is the record after the token is cleared. A manual Team is joined or
left by the user in Town or Board, or by the World service's clients, and World
is its record. A relation SHALL NOT cross connections, except a saved spawn
claim carried by an explicit agent move between runtimes, and the service
SHALL refuse a Team that would. A spawned desk SHALL show its parent's colour
across such a move too. Evidence whose terminals are not in a current
snapshot SHALL be shown as stale, and the service SHALL drop a saved claim or
Team member once a current snapshot that lists every pane of its connection
shows its terminals closed. Herdr SHALL remain the record for layout: a group
moves a tab only through Herdr's own tab moves.

#### Scenario: An agent spawns another

- **WHEN** a pane carries `spawned_by` naming another pane on its connection
- **THEN** Town walls the two desks in and connects them, Board strings their cards, and the child takes its parent's colour

#### Scenario: Group desks by hand

- **WHEN** the user joins one desk to another's team in Town or Board
- **THEN** World saves the group and shows both as one team in every view

#### Scenario: A relation's host is offline

- **WHEN** the connection holding a related terminal is cached after a failure
- **THEN** the relation is kept and shown as stale

#### Scenario: A Team across connections

- **WHEN** a client asks to group terminals of two connections
- **THEN** the service refuses and saves nothing

#### Scenario: Herdr restarts

- **WHEN** a complete current snapshot no longer lists a saved claim's terminals
- **THEN** the service drops the claim, and a new stamp makes a new one

#### Scenario: A spawned agent moves to another runtime

- **WHEN** a spawned agent whose desk shows its parent's teal moves to a herdr-core room
- **THEN** the spawn line still joins it to its parent and its desk stays teal
