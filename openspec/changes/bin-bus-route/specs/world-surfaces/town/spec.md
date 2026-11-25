## MODIFIED Requirements

### Requirement: Closure queues keep presentation separate from execution

Town's bin and its bus SHALL display the shared qualified close intents and
their deadline, with a bounded queue at the bus stop. Leaving the view SHALL
NOT cancel or duplicate execution. Undo before dispatch SHALL cancel the intent
by its state-conditioned effect rule; uncertain closure SHALL NOT be replayed.
The deadline SHALL be one World fact: the bus back at Apartments at its speed
over one route past every stop with riders, which every view SHALL show.

#### Scenario: Reconnect while an agent waits for closure

- **WHEN** a browser reconnects or switches views before the shared close deadline
- **THEN** it observes the existing intent and remaining deadline without creating another close

#### Scenario: A farther stop closes later

- **WHEN** one agent waits at a stop near Apartments and, separately, another
  waits at a stop farther along the roads
- **THEN** the farther agent's countdown is longer, by the extra distance at
  the bus's speed
- **AND** Town's stops and the bin in every view show the same countdown

#### Scenario: Riders at two stops

- **WHEN** agents wait at two different stops for the same bus
- **THEN** its trip is timed by the bus's one way past both stops and back,
  not by the way to either stop alone

#### Scenario: Different layouts measure one trip

- **WHEN** two browsers with different Town layouts measure different routes
  for the same waiting agents
- **THEN** World keeps the first measure, so the deadline does not change back
  and forth between them
- **AND** both browsers show the bus's distance from that one route
