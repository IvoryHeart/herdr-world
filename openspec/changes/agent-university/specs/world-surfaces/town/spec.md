## ADDED Requirements

### Requirement: The University

Town SHALL show a University, the home of agent profiles, as a civic building
between the town center and the library, with one door per college.

#### Scenario: The University acceptance rules

- **WHEN** Town presents the University
- **THEN** its lot SHALL stand right of the town center, with the library, the
  observatory and the shore moved right by exactly its lot and no room, desk
  or other building moved, on wide and narrow towns alike; its paint SHALL
  follow Town's style system (palette families, light from the upper left,
  one-pixel Town ink outline, 16-pixel tile scale) and, until Town's art
  direction is chosen, SHALL be marked as a placeholder; it SHALL draw at most
  four college doors in World's college order, with a `+N` sign chip for the
  rest; a door SHALL look open when its harness is installed and logged in on a
  host the Hosts filter shows, shut when it is logged out on all of them,
  marked not installed when it is installed on none, and unchanged when its
  state is unknown; counts and states SHALL be on its sign; its building and sign SHALL open the University window,
  which the town center's Buildings ring SHALL also list; the town center's ring
  SHALL NOT offer profile editing and SHALL keep New agent and the Town master

#### Scenario: Codex logged out everywhere

- **WHEN** Codex is installed but logged out on every shown host
- **THEN** the Codex door's pane is dark, and its sign chip says Log in

#### Scenario: A new harness appears

- **WHEN** a connected host reports a harness World had no college for
- **THEN** the University gains its door or its `+N` count and no other
  building or room moves

### Requirement: Hires come out of the University

A confirmed hire from a profile SHALL arrive in Town from the University's
gate.

#### Scenario: Hires come out of the University acceptance rules

- **WHEN** Town plays a profile hire's arrival
- **THEN** the agent SHALL start at the University's gate and walk to its
  room's desk within the existing arrival bounds and reduced-motion rule; a
  hire without a profile SHALL keep its current starting point
