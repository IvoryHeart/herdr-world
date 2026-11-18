# Implementation summary — Office UX and seat actions

- **Parent spec:** [`007-office-ux-and-seat-actions-spec.md`](007-office-ux-and-seat-actions-spec.md)
- **Implemented at:** 2026-08-11
- **Implementation status:** Core slice delivered; bounded canvas callouts, room-targeted seat actions, graphical Agent Bar with a semantic overlay, elastic room layout, and capability-gated room lifecycle actions delivered

> The approved contract is retained unchanged. This record describes the
> delivered implementation and its operational limits.

### 2026-08-11 — Delivered implementation

- **Implemented:** Commits [`05102fe`](../../commit/05102fe), [`59e64ed`](../../commit/59e64ed), and [`f526640`](../../commit/f526640) approve the contract and add the accessible Office selection flow, bounded activity-transition age, capability-gated `New seat` launcher flow, the `Economy` / `Workforce` board labels, and compact agent context in the embedded terminal window title bar. The current UX refinement adds semantic state colours, bounded hover callouts for agents, desks, rooms, and hosts, an in-room `+` action that targets the room’s real Herdr workspace, a separate graphical Agent Bar with a semantic overlay, elastic room placement, and capability-gated room create/rename/close actions backed by Herdr workspace commands. The new seat and room actions use admitted runtime/workspace command paths; they do not create Office-only desks or rooms.
- **Evidence:** `npm run test:web` — 50 files / 345 tests passed; `npm run lint:web` passed; `npm run build:web` passed with the existing large-chunk warning. The full World browser suite passes 26/26 tests, including the room-local seat launcher, Agent Bar connector, terminal persistence, room lifecycle flows, and configurable room alignment. Browser evidence files are intentionally left to the working tree for review and are not part of this source commit.
- **Constraints / operational notes:** Activity context currently shows only the latest qualified status-transition age, or `No transition data available`; it does not fabricate a timeline. New seats become visible in Office only after admitted snapshot reconciliation. Normal Herdr exit and pane close remain the authoritative lifecycle.
- **Drift from approved spec:** None. The bounded activity display is the permitted first-slice form of activity context.
- **Interaction refinement:** The embedded terminal title bar now carries the selected agent’s compact, colour-coded state/activity summary and a maximize action for opening the full terminal in Spaces. Host information remains in the terminal title bar; the old bottom selection/status panel, page-level title-bar inspector, and text handoff button have been removed. Escape remains available to the focused Herdr terminal stream.
- **Overview and room lifecycle:** The Agent Bar is a separate graphical room beside the CEO Office, with a dedicated pixel-road separator and a semantic keyboard/screen-reader overlay. CEO furniture and bar agents retain their native scale; CEO boards and reception stations distribute across the available CEO area, while the Agent Bar expands to its wide-screen footprint when space permits. The persistent Office notice/status strip is removed to give the canvas its vertical space back. Room rename and close controls sit on each room title bar; close reuses the existing confirmation dialog. A capability-gated `New room` action is presented as an in-scene `+` below the room row and creates a named Herdr workspace. Rooms use sequential natural-width packing based on their 2–8-seat templates, with each row fitting independently, defaulting to left alignment, and keeping a snug fixed gap; the Office settings surface can switch room rows to center or right alignment. A wide room in one row cannot constrain the next row. Selected-room actions remain unavailable when the selected host does not advertise them.
- **Callouts and seat placement:** In-scene callouts use bounded authoritative metadata with the existing roster as the semantic fallback. Each room exposes a `+` at the next available desk location; after Herdr admits the created tab, the new desk occupies that location and the action advances to the next slot. Once a room reaches eight desks, the room-local affordance remains visible as a disabled `ROOM FULL` marker rather than disappearing.
- **Conversation lifecycle hardening:** Office terminal bubbles are now retained across transient snapshot loading, reconnect generation changes, and projection refreshes. Selection changes and room-local seat creation do not implicitly clear existing bubbles; a bubble is removed automatically only after a ready, admitted snapshot confirms that its pane no longer exists. A newly-created seat is selected and opened after its pane is admitted.
- **Resize safety:** Terminal fitting is debounced during rapid host-size changes and its pending timer/frame is cancelled during teardown, preventing a resize burst from monopolising the page or leaving stale renderer work behind.

### 2026-08-30 — Semantic touch-target extension

- **Implemented:** The published Office layout now drives transparent semantic
  buttons for rooms, waiting/standing agents, and each desk station. Every
  target is at least 48 by 48 CSS pixels, carries a qualified accessible label,
  and preserves single-click selection plus supported double-click Spaces
  handoff. An occupied desk and its agent share one target, avoiding ambiguous
  duplicate selection.
- **Compact fallback:** Phone layouts expose a touch-sized `Office targets`
  chooser with bounded Agents, Rooms, and Desks sections. It remains usable
  independently of precise canvas hit testing and exposes task summaries and
  available Spaces actions.
- **Evidence:** Geometry unit coverage checks exact target identities, labels,
  and minimum dimensions. Component coverage checks compact selection, and the
  compact World browser flow verifies semantic target dimensions and chooser
  selection at 375 px.
