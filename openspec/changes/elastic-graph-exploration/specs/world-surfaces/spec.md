## ADDED Requirements

### Requirement: Elastic Graph interaction across screen sizes

Graph SHALL present its interactive spatial canvas on desktop and phones, with
the same qualified topology and interaction meanings. Selecting a node SHALL
inspect that entity without replacing the map with a separate workspace graph.
Explicit disclosure SHALL expand or collapse children in place. Viewport framing
and control placement SHALL adapt to the screen without substituting Tree for
the phone canvas or changing an operation's owning entity.

Direct manipulation SHALL preserve an elastic, playable response while retaining
predictable selection, useful labels, settled-layout continuity and distinct pan,
zoom and disclosure actions. Status-only updates SHALL NOT restart decorative
motion or discard the user's camera and positions. Reduced-motion, hidden-view,
terminal-input responsiveness and qualified action boundaries SHALL remain in
force. The equivalent semantic hierarchy SHALL remain available for users who
cannot operate the canvas.

#### Scenario: Inspect without losing spatial context

- **WHEN** a phone or desktop user selects a host, workspace or agent node
- **THEN** the shared details identify that exact entity while the graph retains
  its topology, disclosure, node positions and camera

#### Scenario: Disclose a workspace explicitly

- **WHEN** a user invokes a workspace's expand or collapse control
- **THEN** its children change visibility in the same map without treating the
  disclosure gesture as terminal activation or workspace navigation

#### Scenario: Move nodes playfully on either screen size

- **WHEN** a user drags and releases a graph node by pointer or touch
- **THEN** the graph provides the accepted elastic movement without confusing the
  drag with inspection, drawing false ancestry links or redirecting another
  host's actions

#### Scenario: Reduce motion or operate without the canvas

- **WHEN** reduced motion is requested, a terminal receives input, Graph is hidden
  or a user needs semantic navigation
- **THEN** motion follows the existing accessibility and resource boundaries and
  the same qualified entities remain inspectable without precise canvas gestures
