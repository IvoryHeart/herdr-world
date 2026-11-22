# World town moves

## Purpose

Define the user-facing town moves contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Town desk and agent moves

Town SHALL let the user move a desk to the next free spot of another room of
the same host and move an agent pane to another desk of the same host, by
dragging with a mouse, by holding and then dragging on touch, and from the
keyboard by pressing M on a focused desk or agent target, which opens a list of
destinations.

#### Scenario: Town desk and agent moves acceptance rules

- **WHEN** World prepares, dispatches or reconciles Town moves
- **THEN** Town SHALL NOT add visible move controls to the scene. While a
  drag is in progress Town SHALL show where the desk or agent would land, or why
  it cannot, and holding the carried desk or agent near the edge of the usable
  view SHALL scroll the town toward that edge, so rooms out of view can be
  reached. A picked-up desk or agent SHALL lift off and follow the pointer;
  every move Herdr confirms, within a room or to another room, SHALL land on its
  target with a puff of dust, and a refused move SHALL return to where it was.
  Under reduced motion or calm motion the carried desk or agent SHALL stay under
  the pointer, and every drag SHALL end with a short fade, without bounce, shake
  or dust. A request SHALL be qualified by connection ID and runtime generation,
  SHALL run in the World service, and SHALL be refused across hosts, for retired
  generations, or when the runtime cannot export a tab's layout. Before sending
  any move, a desk move SHALL capture the source tab's complete split tree with
  `layout.export`, including each split's direction and ratio, and SHALL refuse
  the move without mutation if any source pane is missing or the tree does not
  account for every pane. Because Herdr closes a workspace when its last tab
  leaves, moving a room's last desk, or the only pane of a room's last desk, SHALL
  ask the user to confirm that the room will close before anything moves. It SHALL
  then move the captured tree's first pane to a new tab in the target workspace and
  replay the captured tree by moving each remaining pane into that tab with its
  captured direction and ratio, confirming each step from Herdr before the next.

  Because a move can replace a pane's operational ID, World SHALL record each
  confirmed replacement from `pane.moved` and SHALL address every later split
  target, rollback step and Town target by the current ID, including any further
  replacement during rollback. If a step fails, World SHALL move the already-moved
  panes back into the original tab using their current IDs and report the outcome.
  It SHALL NOT retry an uncertain step, and if rollback fails it SHALL report the
  actual resulting topology.

  Service move adapters SHALL share one service-owned queue per connection and
  use the captured connection/generation without a default fallback. A queued
  retired generation SHALL be refused. Topology and source colours SHALL be read
  at queue admission. Board following SHALL retain its ordering after move
  serialization: confirmed replacement IDs may be followed, and failed moves
  SHALL reconcile only positively observed terminal witnesses. Unknown locations
  SHALL NOT be guessed. A Board-follow failure SHALL NOT replace the real move
  outcome with a success or discard partial/unknown topology.

  Town SHALL let the user reorder a desk within its room the same ways: dropping
  it on another desk of its room puts it in that desk's slot, as a tab dragged
  onto another in Spaces, and dropping it on the room's free spot puts it last of
  the drawn desks, so in a room with more tabs than it draws the desk takes the
  last drawn desk's place and stays in view. Only a seated agent stands for its
  desk's slot; a drop on an agent in the lounge, at reception or walking SHALL
  NOT reorder. The keyboard list SHALL offer the same places before other rooms. A reorder SHALL read the
  workspace's tab order from Herdr and send one Herdr `tab.move` through the same
  browser path as Spaces' tab strip, qualified by the desk's connection ID and
  runtime generation. Town SHALL NOT keep an order of its own: desks SHALL move
  when Herdr's new order is observed, and a refused reorder SHALL leave every desk
  in place and say why; on a Herdr without `tab.move`, Town SHALL say so in plain
  words before sending anything. The World service SHALL subscribe to Herdr's
  `tab.moved` event where Herdr supports `tab.move`, so a reorder made anywhere
  refreshes every view; when it cannot yet tell whether Herdr does, it SHALL retry
  the subscription rather than subscribe without `tab.moved`. Agents keep their desk across a reorder: a seated agent moves with
  its desk, an agent walking to it or sitting down walks to the new slot, and agents at reception
  or in the lounge return to the same desk.

  An agent move SHALL be a single confirmed pane move into the target tab. The
  service SHALL read the destination tab's complete layout, including panes Town
  does not draw, and join the pane next to its last pane, splitting across the
  table when the tab has an odd number of panes and beside it otherwise, with its
  replacement ID recorded. Moves on one connection SHALL run one at a time, each
  reading the topology, including the last-desk check, only when it starts.
  Rollback SHALL be reported as complete only when every captured pane is found
  back in the original tab; an unreadable topology, a retired runtime or a failed
  compensation SHALL be reported as an incomplete move, and the runtime SHALL be
  checked before every compensating move. When panes were moved back, World SHALL
  report that the desk's pane layout may differ, because Herdr cannot always
  rebuild the original split tree. While a move is pending, Town SHALL reserve the source
  and target spots; the final placement SHALL follow confirmed Herdr topology.

#### Scenario: Move a desk to another room

- **WHEN** the user drags a three-pane desk onto another room of the same host
- **THEN** World captures the desk's split tree before moving anything, moves the
  three panes into one new tab in that workspace with the same split directions
  and ratios, shows the desk at the target spot after Herdr confirms, and the
  agents keep their agent identities while Town follows each replacement pane ID

#### Scenario: A moved pane receives a new ID

- **WHEN** Herdr confirms the first pane of a desk move with a different `pane_id`
  than its `previous_pane_id`
- **THEN** World addresses the next split and any rollback by the new ID, and
  Town's seat, peek and terminal targets for that agent use the new ID

#### Scenario: A source pane disappears before the move

- **WHEN** a pane of the selected desk closes between the user's drop and the
  capture of the split tree
- **THEN** World sends no pane move, the desk stays in place, and the user sees
  that the move could not start

#### Scenario: A desk move fails part-way

- **WHEN** Herdr rejects the second pane move of a three-pane desk
- **THEN** World moves the first pane back into the original tab by its current
  ID, Town returns
  the desk to its original spot, and the user sees that the move failed

#### Scenario: Drop on another host

- **WHEN** the user drops a desk over another host's building
- **THEN** no Herdr operation is sent, the desk returns to its spot, and Town
  explains that desks move only within one host

#### Scenario: Move a room's last desk

- **WHEN** the user drops the only desk of a room onto another room of the same host
- **THEN** Town asks to confirm that the room will close, and moves the desk only
  after the user confirms

#### Scenario: Reorder a desk in its room

- **WHEN** the user drags the room's first desk onto its third desk
- **THEN** World sends one `tab.move` for that tab on the desk's own connection
  and runtime generation, and after Herdr reports the new order the desk sits in
  the third slot and the second and third desks sit one slot earlier

#### Scenario: Move an agent to another desk

- **WHEN** the user drags an agent onto another desk in the same host
- **THEN** World moves exactly that pane into the target tab and the agent sits at
  the chosen seat after Herdr confirms
