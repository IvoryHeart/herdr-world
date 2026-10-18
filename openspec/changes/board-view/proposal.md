## Why

Graph shows the same topology as Tree, drawn as a force graph. Fit and zoom work,
but after that it feels rigid: nodes are hard to move, open and close, and on
phones Graph falls back to a plain list of workspaces and tabs. The owner wants
the graph to become a place to think and plan with agents: an elastic, readable
board where hosts, workspaces and agents sit beside the user's own notes, and
where a note can be handed to an agent as work.

A playable prototype reviewed with the owner on 2026-10-18 settled the direction
described here (three revisions, synthetic data only).

## What Changes

- Add a **Board** view next to Graph: hosts as labelled zones, workspaces as
  cards, tabs as cards around their workspace, and the user's sticky notes.
  Graph, Tree and the Pixel Office keep working; retiring them is a later,
  separate decision.
- Make the board elastic only while the user interacts: dragging a workspace
  pulls its tabs along on springs, a thrown card glides, and the board settles
  and goes still within about a second. Cards keep the place the user gives
  them. Layout never depends on zoom.
- Add semantic zoom over one layout: zoomed out, tabs fold into their
  workspace's status squares and workspace cards grow to stay readable; zoomed
  in, tabs return.
- Fold a workspace into a stack and unfold it into free space around it
  without pushing other cards. Tidy rearranges only the selection (or the whole
  board when nothing is selected) and can be undone.
- Show status as coloured pulses on every tab (working, needs you, finished,
  idle, no signal), on by default, with a setting in the view's ⋯ menu.
- Add a detail panel for tabs and workspaces with Output, Files, Changes and
  History, built on World's existing agent history, file and git operations.
  The panel answers waiting agents and opens the terminal and its composer.
- Add notes and strings: notes are created on the board, strung to cards, cut,
  coloured and edited. A note strung to an agent can be sent to it, and a note
  can start a new agent in a chosen workspace.
- Persist board layout, notes and strings in the World service, per connection
  profile, so phone and desktop show the same board. Anchor items to Herdr
  workspace, tab and pane identities with explicit handling when an anchor
  disappears or can no longer be confirmed.
- Show the same board on phones, with stacked hosts, pinch zoom, direct drag
  and the panel as a bottom sheet.

## Capabilities

### Modified Capabilities

- `world-surfaces`: adds the Board view, its placement and movement, semantic
  zoom, detail panel, status pulses, notes and strings, persistence and
  identity, and phone presentation.

## Impact

- Web: a new `web/src/world/board/` module (model, placement, physics, view),
  the view switcher and phone navigation, and the existing Inspector views for
  files, diffs and history.
- Service: a bounded board store beside the connection profiles, with
  qualified RPCs to read and update it and a change broadcast to clients.
- Herdr: no new requirement. Herdr 0.9.3 has display-only pane and workspace
  metadata (at most 16 tokens, lost on restart), which cannot hold notes. A
  proposal for durable annotations in Herdr is listed as optional follow-up and
  needs the owner's approval before it is raised upstream.
- Docs: `docs/TUTORIAL.md`, `FEATURES.md`, the README view list and the
  knowledge map gain Board.
