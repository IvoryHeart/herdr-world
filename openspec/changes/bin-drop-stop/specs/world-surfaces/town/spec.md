## MODIFIED Requirements

### Requirement: Closure queues keep presentation separate from execution

Town's bin and bus SHALL show the shared qualified close intents and their
deadline, with a bounded queue at each stop; an agent dropped on a stop SHALL
wait there. Leaving the view SHALL NOT cancel or duplicate execution. Undo
before dispatch SHALL cancel the intent by its state-conditioned effect rule;
uncertain closure SHALL NOT be replayed. The deadline SHALL be one World fact,
shown by every view: the bus back at Apartments at its speed over one route
past every stop with riders.

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

#### Scenario: Agents dropped on two stops

- **WHEN** one agent is dropped on one Town bus stop and another on a
  different stop
- **THEN** each walks to the stop it was dropped on and waits there, in every
  Town and after a reload; World keeps the stop with its bin entry as a
  building corner, so it stays the same stop as Town grows or reflows
- **AND** the bus calls at both stops before it goes back to Apartments

#### Scenario: The dropped stop is gone

- **WHEN** a Town has no stop at the building corner World kept for a waiting
  agent, or the agent was put in the bin from the bin itself, a menu or Board
- **THEN** it waits at the stop nearest its room
