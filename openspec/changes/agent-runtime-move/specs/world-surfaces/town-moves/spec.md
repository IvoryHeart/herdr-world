## ADDED Requirements

### Requirement: Agent moves between runtimes

World SHALL let the user move an agent's desk to a room of another runtime of
the same machine (Herdr TUI to herdr-core or back) by dragging the desk into
that room in Town, from Town's M list, and with Move to… on the desk's Town
and Board peeks. A move within one runtime SHALL use that runtime's own move;
two connections that reach the same runtime are one runtime, so Move to…
SHALL NOT offer the same Herdr's rooms as another runtime and the service SHALL
move such a desk natively. A herdr-core desk moved to another core room SHALL
keep running and keep its Board colour, pin and links under its new tab.
Every move step SHALL be logged by the service, and a refusal SHALL tell the
user its reason. Once an agent moves, World SHALL refuse to move it again until
the move settles. A move SHALL outlive the page's socket: a page that lost the
reply SHALL learn that move's outcome once it reconnects, without moving again.

#### Scenario: Agent moves between runtimes refusals

- **WHEN** a move between runtimes is requested
- **THEN** The request SHALL run in the World service, qualified by both connections' IDs
  and runtime generations, and SHALL be refused for a retired generation,
  across machines, for a desk with more than one terminal, for an agent that is
  working or waiting for an answer, for a plain terminal running a program
  other than its shell, and for a herdr-core agent whose own agents would end
  with it. One service SHALL hand over one agent at a time, and an agent that
  just moved SHALL be refused with "settling" until its move settles.

#### Scenario: Agent moves between runtimes handoff rules

- **WHEN** World hands an agent over to another runtime
- **THEN** World SHALL start the agent's harness on the destination with its
  conversation resumed and wait until it is ready. When there is nothing to
  resume (a plain terminal, or a harness whose conversation World cannot find),
  World SHALL first say that the conversation won't continue and move only once
  the user confirms; it SHALL then start the same harness fresh, or a new shell,
  in the same folder. Right before closing, World SHALL check the original
  again: it SHALL still be the same idle agent or idle shell, alone at its desk,
  or World SHALL put the desk back, close the new copy and leave the original
  running. World SHALL carry the desk to the new address before that check and
  close the original, ending only
  what it admitted: a herdr-core child started since admission SHALL refuse the
  close. If the original refuses to close, World SHALL put the desk back, close
  the new copy and say the original still runs. When an end was asked but not
  confirmed, World SHALL say which agent may still be running instead of
  reporting a move or a clean refusal; this includes a lost close reply after
  which the original can't be read (World keeps the new copy) and a lost start
  reply (the original keeps running and the copy may be).
  A harness that refuses or forks a conversation open elsewhere (Codex; or a
  copy that reports another conversation) SHALL be closed first and then
  resumed on the destination; if the destination does not start it, World
  SHALL resume it back where it was, and if that fails too World SHALL name
  the saved conversation and how to continue it.

#### Scenario: Agent moves between runtimes desk rules

- **WHEN** World carries a moved desk to its new address
- **THEN** The Board operation `agent.rehome` SHALL move the desk's saved place, colour,
  pin, fold, appearance, strings and spawn links from the old address to the
  new one. A spawn claim whose parent moved SHALL name the new parent and keep
  the old one in `moved_from`, so the child's live token naming the old parent
  neither replaces nor duplicates the claim. Observations SHALL never infer a
  move.

#### Scenario: Drag a desk to the other runtime

- **WHEN** the user drags an idle Claude desk from a Herdr TUI room into a herdr-core room of the same machine
- **THEN** the agent runs there with its conversation resumed, its desk keeps its pin, colour and spawn lines, and the original closes

#### Scenario: A moved desk moves again

- **WHEN** a pinned desk moved from Herdr TUI to herdr-core is moved again, to another herdr-core room or back to a Herdr TUI room
- **THEN** Town offers that room in the drag and the M list, the agent moves there, and its desk stays pinned

#### Scenario: Nothing to resume

- **WHEN** the user moves a plain terminal, or an agent whose conversation World cannot find, to the other runtime
- **THEN** World says the conversation won't continue and, once confirmed, starts a new shell or the same harness fresh in the same folder there, keeps the desk's pin, colour and spawn lines, and closes the original

#### Scenario: The original starts working during the handoff

- **WHEN** the original agent starts working before it closes
- **THEN** World closes the new copy, keeps the original and its desk, and says why

#### Scenario: A close that is not confirmed

- **WHEN** herdr-core does not confirm that the original ended
- **THEN** World says the agent runs in its new room and the original may still be running

#### Scenario: Codex closes before it resumes

- **WHEN** the user moves an idle Codex agent to the other runtime and the destination does not start it
- **THEN** World resumes the agent back in its room with its desk, and says it didn't start there

#### Scenario: Two connections of one Herdr

- **WHEN** two connections reach the same Herdr and the user opens Move to… on a desk
- **THEN** the other connection's rooms are not offered as another runtime, and a move between them runs natively with nothing closed

#### Scenario: A moved agent moves again too soon

- **WHEN** the user moves an agent again before its last move has settled
- **THEN** World refuses with the reason that the agent is still settling

#### Scenario: The page loses its socket during a move

- **WHEN** the page's socket closes while a move runs (a slow or remote link)
- **THEN** the move runs to its end, and once the page reconnects it shows how that move ended, and nothing moves twice
