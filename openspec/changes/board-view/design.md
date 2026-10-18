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
- Notes belong to the whole board, strung to what they concern; a disconnected
  workspace must not move or remove them.

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

### 4. Identity, continuity and anchors

Probes in isolated Herdr 0.9.3 sessions (deleted afterwards) showed:

- workspace, tab and pane IDs (`w2`, `w2:t1`, `w2:p1`) survive a server
  restart, and within one running server they are never reused: after closing
  `w2` the next workspace is `w3`, after closing `t2` the next tab is `t3`;
- a fresh session starts again at `w1`, so IDs alone cannot tell a restored
  session from a new one;
- terminal IDs are random, survive `pane.move`, and change when the server
  restarts;
- pane IDs change on `pane.move` (World learns the replacement from the move
  result);
- Herdr exposes no session or server instance identity, and metadata tokens
  are lost on restart.

**Anchors.** A string attaches to a pane, a tab or a workspace by connection
profile ID and Herdr ID. Labels, directories and agent kinds are display data
only: renames and agent start or stop never detach anything.

**Continuity witness.** With every anchor the store keeps the terminal IDs of
the target's panes as last observed (for a pane anchor, its own terminal ID),
refreshed on each authoritative observation. Because terminal IDs change only
when Herdr restarts, an anchor is _confirmed_ when its target exists and at
least one witnessed terminal ID is still present in it. This covers World
restarts, reconnects and other clients without user action.

**Anchor states.**

- _Attached_: confirmed on the current runtime generation. Fully actionable.
- _Unresolved_: the host is connecting, offline, stale, filtered, or the target
  is outside the admitted topology. The note keeps its place; its string is
  drawn dashed to the last known card position (or the host zone) with the
  reason; Send and answers are disabled. Nothing is detached while unresolved.
- _Unconfirmed_: the host is current and the ID exists, but no witnessed
  terminal survives (Herdr restarted, or a new session reuses the ID). World
  cannot prove it is the same target, so the string is dashed, Send is
  disabled, and the host shows one prompt listing the affected notes with
  Keep (re-witness) or Detach, per item or for all.
- _Detached_: absence is authoritative, meaning a close event observed on the
  current generation, or a qualified `workspace.get`, `tab.get` or `pane.get` on
  the current generation answering not found. The item moves to the "Needs a
  home" tray. Items are never deleted or re-attached without the user.

A World-initiated pane move rewrites the pane anchor through the move result
and keeps its witness. A pane moved outside World leaves its old ID absent and
detaches; Herdr does not report a moved pane's previous ID.

**Disconnected hosts.** Notes belong to the whole board, so a disconnected
workspace never moves or removes a note. Its strings become unresolved and
re-attach automatically when the host returns with a surviving witness, or ask
for confirmation if Herdr restarted meanwhile.

### 5. A bounded World store

The service owns the board store beside the connection profiles: one document
per connection profile, written atomically, revisioned, and bounded (notes of
at most 4,000 characters, at most 500 notes and 2,000 strings per profile, at
most 2,000 positioned cards). Browser RPCs read and patch it qualified by
connection ID; patches carry the base revision and conflicting item edits are
rejected and re-read rather than merged blindly. The service broadcasts board
changes so other open clients (for example the phone) update live.

Board content is user content kept by the World service. Authenticated World
clients of that service (for example the user's phone) receive it to display
and edit the board. Note text goes to Herdr or an agent only when the user
explicitly sends it. Nothing else from the board is written to Herdr in this
change.

Herdr's display-only metadata cannot hold this data. If the owner approves, a
follow-up proposes durable annotations to Herdr (attached to a workspace, tab or
pane and persisted with the session), and the World store would then migrate
anchored notes to it.

### 6. Agent operations reuse existing paths

- A tab can hold several panes and agents, so every agent operation targets an
  exact pane. Stringing a note to a tab with more than one pane asks which pane
  (the chooser Town uses); a single-pane tab selects its pane. A note may also
  be strung to a tab or workspace as context, but Send needs a pane string.
- Answering: the tab panel lists each pane that needs the user, with its own
  question and answers, delivered over the same exact-pane path as Town's peek
  (qualified by connection ID and runtime generation).
- Sending a note: at Send, World revalidates the string (attached, current
  generation, witness present, `agent.get` reports an agent on that pane) and
  then calls `agent.prompt` with that pane as the target and the note text.
  Any failed check refuses with its reason. It is only ever triggered by the
  user's Send.
- Starting an agent from a note creates a tab in the chosen workspace
  (`tab.create`), starts the chosen agent in its root pane (`agent.start`, which
  requires a pane), then waits, bounded, for `agent.get` to report the agent on
  that pane as `interactive_ready`, as World's assistant start flow already
  does (`server/src/assistant/actions.ts`). Only then does it prompt with the
  note and string the note to the pane. A timeout is reported as uncertain
  ("the agent may still be starting; the note was not sent") with a Send
  action; no step, and never the prompt, is retried automatically. Any failure
  reports what was created.
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

- [A new Herdr session reuses IDs] → without a surviving terminal witness the
  anchor is unconfirmed and needs the user's Keep; nothing is sent meanwhile.
- [A Herdr restart restores the same session] → the same prompt appears once
  per host; Keep all re-witnesses every anchor. Durable annotations or a
  session identity in Herdr would remove this prompt (optional follow-up).
- [Pane moves made outside World] → the pane anchor detaches into the tray.
  Herdr does not report a moved pane's previous ID in topology reads.
- [DOM card count at maximum scale] → overview hides tabs; viewport culling;
  verified against the Town input budgets.
- [Store growth] → hard bounds with clear errors; no unbounded history.
- [Two clients editing] → revisioned patches and live broadcast; a rejected
  patch re-reads and shows the latest note.

## Open Questions

- Durable annotations (or a session identity) in Herdr: the owner chose to
  track this in a World issue now and raise it upstream as a proposal after
  Board ships.
