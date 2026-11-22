## ADDED Requirements

### Requirement: Agent moves between runtimes

World SHALL let the user move an agent's desk to a room of another runtime of
the same machine (Herdr TUI to herdr-core or back) by dragging the desk into
that room in Town, from Town's M list, and with Move to… on the desk's Town
and Board peeks. A move within one runtime SHALL use that runtime's own move.
The request SHALL run in the World service, qualified by both connections' IDs
and runtime generations, and SHALL be refused for a retired generation,
across machines, for a desk with more than one terminal, for an agent that is
working or waiting for an answer, for a plain terminal running a program
other than its shell, and for a herdr-core agent whose own agents would end
with it. One service SHALL hand over one agent at a time.

World SHALL start the agent's harness on the destination with its
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

#### Scenario: Nothing to resume

- **WHEN** the user moves a plain terminal, or an agent whose conversation World cannot find, to the other runtime
- **THEN** World says the conversation won't continue and, once confirmed, starts a new shell or the same harness fresh in the same folder there, keeps the desk's pin, colour and spawn lines, and closes the original

#### Scenario: The original starts working during the handoff

- **WHEN** the original agent starts working before it closes
- **THEN** World closes the new copy, keeps the original and its desk, and says why

#### Scenario: A close that is not confirmed

- **WHEN** herdr-core does not confirm that the original ended
- **THEN** World says the agent runs in its new room and the original may still be running
