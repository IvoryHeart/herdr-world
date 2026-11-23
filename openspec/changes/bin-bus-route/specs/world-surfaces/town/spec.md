## MODIFIED Requirements

### Requirement: Closure queues keep presentation separate from execution

Town's bin and its bus SHALL display the shared qualified close intents and
their deadline, with a bounded waiting queue at the bus stop. Leaving the view
SHALL NOT cancel or duplicate execution. Undo before dispatch SHALL cancel the
intent through its ordinary state-conditioned effect rule; uncertain native
closure SHALL remain uncertain rather than being automatically replayed. The
deadline SHALL be one World fact: when the bus is back at Apartments, from its
speed and route to its stops.

#### Scenario: Reconnect while an agent waits for closure

- **WHEN** a browser reconnects or switches views before the shared close deadline
- **THEN** it observes the existing intent and remaining deadline without creating another close

#### Scenario: A farther stop closes later

- **WHEN** one agent waits at a stop near Apartments and, separately, another
  waits at a stop farther along the roads
- **THEN** the farther agent's countdown is longer, by the extra distance at
  the bus's speed
- **AND** Town's stops and the bin in every view show the same countdown

#### Scenario: Different layouts measure one agent

- **WHEN** two browsers with different Town layouts report different routes
  for the same waiting agent
- **THEN** World keeps the first report, so the deadline does not change back
  and forth between them
