## Context

Graph (`SpatialGraphView`, `web/src/world/graph/`) projects World's bounded
topology into a force-directed canvas with saved positions in browser storage.
On phones it renders a list. The owner reviewed a playable Board prototype on
2026-10-18 (https://claude.ai/artifact/XJNywaVkbYjZMkZkmA7RSt, synthetic data).
Its lessons are recorded here; its code is not a production source.

Owner decisions from the review:

- The elasticity, the notes, sending notes to agents, the overview summaries
  when zoomed out and the detail panel are the direction.
- Ambient movement disturbs serious work. Cards move only when the user moves
  them, and the board settles quickly. Card movement is not a setting.
- Status pulses stay on by default, coloured by status; turning them off is a
  setting in the view's ⋯ menu (the menu Town already uses).
- Unfolding must use free space rather than crowd other cards.
- Tidy was liked but felt distracting when it rearranged everything.
- Files, changes and history belong in the panel for quick access, for tabs and
  for workspaces.
- Name the view Board. Graph, Tree and the old Office retire gradually, later.

## Goals / Non-Goals

**Goals**

- A board that is calm at rest, elastic under the hand and spatially stable:
  nothing moves unless the user moves it or the topology changes.
- Readable at every zoom level and complete: every admitted tab stays
  reachable.
- Notes and strings that persist across devices and survive Herdr restarts.
- Exact, qualified agent operations: answering, sending a note and starting an
  agent use the existing connection- and generation-qualified paths.
- The same model on desktop and phone.

**Non-Goals**

- Retiring Graph, Tree or the Pixel Office.
- Frames, checklists, string labels or several boards per project. The owner
  wants to see these working first; they are candidate follow-ups.
- Cross-host strings that imply operations. A string is a note-level link only.
- A Herdr protocol change. Durable annotations in Herdr are an optional
  follow-up.

## Decisions

### 1. DOM cards and an SVG string layer

Board cards are text-heavy, editable (notes) and must be focusable and
announced. Cards are DOM elements positioned by transform inside one scaled
world element; strings and tree lines are SVG paths in the same world. At the
owner's maximum scale (three hosts, eight workspaces per host, fifteen tabs per
workspace) the overview hides tab cards, so at most about 24 workspace cards
and the notes are visible; zoomed in, cards outside the viewport are skipped
when painting. Input acknowledgement budgets from the Town baseline apply and
are verified with the maximum-scale fixture.

### 2. Offsets, free space and short-lived physics

Each tab stores an offset from its workspace and each workspace an offset from
its host's anchor. While the user drags, cards spring toward anchor plus offset,
so a workspace pulls its tabs along; overlaps resolve along the shallower axis.
A heat value starts at 1 on any interaction and decays to zero within about a
second; at zero the board writes every card's current offset and stops
simulating. A thrown card glides with friction and keeps its offset where it
stops. Pinned cards hold an absolute position and do not follow their
workspace.

New tabs, unfolded tabs, new notes and tidy use one placement function: rings
around the centre (wider than tall, since cards are wide), visiting angles in a
spread order and taking the first spot whose rectangle clears every visible
card. Physics uses each card's normal size at every zoom, so zooming never
moves cards.

### 3. Semantic zoom

Below about 44 % scale (with hysteresis) the board shows the overview: tab cards
fade out and their status squares on the workspace card grow; workspace labels,
notes and host labels enlarge in world units so they stay legible. Strings to a
hidden tab attach to its workspace. Fit measures what is drawn at the current
level.

### 4. Identity and anchors

A probe in an isolated Herdr 0.9.3 session showed workspace, tab and pane IDs
(`w2`, `w2:t1`, `w2:p1`) survive a server restart and are not renumbered when
other workspaces close; terminal IDs change on restart; pane IDs change on
`pane.move` (World learns the replacement from the move result); metadata
tokens are lost on restart.

Board items are therefore anchored to the connection profile ID plus the
Herdr workspace, tab or pane ID, with a fingerprint (workspace label and cwd,
tab label, pane agent) captured when the item is attached. On each topology
read:

- an anchor whose ID exists and whose fingerprint matches stays attached;
- a World-initiated pane move rewrites the pane anchor through the move
  result;
- an anchor whose ID is missing, or whose fingerprint no longer matches (for
  example a new Herdr session reusing `w1`), detaches its notes into a
  "Needs a home" tray. Detached items are never deleted, never silently
  re-attached, and the user can re-attach or discard them.

Board positions for cards are keyed the same way; a card whose anchor is gone
simply disappears with its topology.

### 5. A bounded World store

The service owns the board store beside the connection profiles: one document
per connection profile, written atomically, revisioned, and bounded (notes of
at most 4,000 characters, at most 500 notes and 2,000 strings per profile, at
most 2,000 positioned cards). Browser RPCs read and patch it qualified by
connection ID; patches carry the base revision and conflicting item edits are
rejected and re-read rather than merged blindly. The service broadcasts board
changes so other open clients (for example the phone) update live.

Notes are user content stored only on the service host. They leave it only
when the user explicitly sends a note to an agent. Nothing from the board is
written to Herdr in this change.

Herdr's display-only metadata cannot hold this data. If the owner approves, a
follow-up proposes durable annotations to Herdr (attached to a workspace, tab or
pane and persisted with the session), and the World store would then migrate
anchored notes to it.

### 6. Agent operations reuse existing paths

- Answering a waiting agent uses the same exact-pane path as Town's peek
  (qualified by connection ID and runtime generation).
- Sending a note uses Herdr `agent.prompt` on the strung agent's pane through
  the qualified connection route, with the note text as the prompt. It is only
  ever triggered by the user's Send.
- Starting an agent from a note creates a tab in the chosen workspace
  (`tab.create`), starts the chosen agent in its root pane (`agent.start`, which
  requires a pane), prompts it with the note (`agent.prompt`) and strings the
  note to the new pane. A failure at any step is reported with what was
  created; nothing is retried automatically.
- The detail panel's Files, Changes and History use `agent_history.*`,
  `file.read`, `git.diff_summary`, `git.diff_file` and the commit operations,
  opening the existing Inspector views for full detail. Workspace Changes use
  the workspace's repository summary; workspace Files and History combine its
  tabs' entries, newest first.

### 7. Pulses and settings

Pulses are CSS rings in the status colour with a pace set by urgency (needs you
fastest, idle slowest), shown on tabs, on workspaces with a waiting tab, and on
the overview's status squares. They respect reduced motion. The view's ⋯ menu
holds Status pulses, the board surface (whiteboard or blackboard, following the
theme by default) and help.

### 8. Phones

The same board: hosts stack vertically, one finger drags a card or pans empty
board, pinch zooms, double-tap creates a note, the panel is a bottom sheet and
tapping a card centres it above the sheet. Phone Back closes the sheet through
the shared system Back module.

## Risks / Trade-offs

- [Anchors after a Herdr session is recreated] → fingerprints detach rather
  than mis-attach; the tray makes recovery explicit.
- [Pane moves made outside World] → the pane anchor detaches into the tray.
  Herdr does not report a moved pane's previous ID in topology reads, so World
  cannot follow those moves without a Herdr change.
- [DOM card count at maximum scale] → overview hides tabs; viewport culling;
  verified against the Town input budgets.
- [Store growth] → hard bounds with clear errors; no unbounded history.
- [Two clients editing] → revisioned patches and live broadcast; a rejected
  patch re-reads and shows the latest note.

## Open Questions

- Whether notes belong to the whole board or to a workspace (moving with it).
  The prototype keeps notes where the user puts them, strung to what they
  concern.
- Whether to raise durable annotations with Herdr upstream now or after Board
  ships.
