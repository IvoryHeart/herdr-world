## ADDED Requirements

### Requirement: Quiet working agents are marked, not acted on

Town SHALL mark an agent as quiet when Herdr reports it working and its last
activity time is at least the browser's threshold old.

#### Scenario: Quiet working agents acceptance rules

- **WHEN** World presents or updates Town and its qualified agents
- **THEN** The threshold SHALL be ten minutes by default, and a setting SHALL
  offer other values or off. An agent without a last activity time SHALL NOT be
  marked. A quiet agent SHALL stay seated with its room's working light on, stop
  its working animation and show a static mark; at the room and desk levels the
  mark SHALL carry how long the agent has been quiet, and a step shown at its
  seat SHALL keep its running time. Its card SHALL say how long it has been
  quiet and when it last moved. The Town board SHALL count quiet agents under
  its working count, and that count SHALL open the first one with Next stepping
  through those still quiet. Marking SHALL NOT change agent facts, counts,
  placement or attention, and SHALL NOT nudge, interrupt or restart the agent or
  add a runtime call.

#### Scenario: A quiet agent moves again

- **WHEN** a working agent last active 23 minutes ago under a ten-minute
  threshold reports a new activity time
- **THEN** its mark, card line and board count clear, and Next skips it
