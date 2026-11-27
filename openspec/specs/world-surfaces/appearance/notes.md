# Appearance notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Terminal header/title-bar editor and menus reach name, colour, status and avatar in every view.
- Town/Board cards, room/building controls and Spaces sidebar menus also reach shared palette choices.
- Phone app bars expose the same appearance; profile assignment/Town master live with the terminal.
- TUI/core use exact native rename and terminal metadata; World persists appearance and palette overrides.

**Code:**

- `shared/terminalColor.ts`
- `web/src/world/TerminalAppearanceEditor.tsx`
- `web/src/world/terminalColor.ts`
- `server/src/features/appearance/register.ts` (construction, RPCs and lifecycle)
- `server/src/features/appearance/verbs.ts`
- `server/src/features/appearance/rpc.ts`
- `server/src/agent/terminal-settings.ts`
- `server/src/features/appearance/service.ts`

**Tests:**

- `server/src/rpc/appearance.test.ts`
- `web/src/world/terminalColor.test.ts`
- `web/src/world/appearance.test.ts` (page convergence and Town/Board colour projections)
- `server/src/agent/terminal-settings.test.ts`
- `web/src/world/TerminalAppearanceEditor.test.tsx`

**Pitfalls:**

- Native tab names are not World shadow names; split avatars are per pane.
- Tab colour inherits spawn/workspace defaults, never host colour or runtime status.
- Saved terminal choices require continuity evidence; reused IDs cannot inherit them.
- Appearance remains connection-scoped: duplicate connections to one TUI endpoint can
  hold different choices. Town shows its endpoint anchor (or a live stand-in), while Board shows each
  connection; compare the same connection when checking colour propagation.
- Herdr assignments have no TTL and end with terminals; World profiles/chimes persist separately.
- CLI colour commands affect shared appearance; task-summary is session-scoped metadata, not status text.

## Usage reference

- **Shared terminal appearance.** The title-bar icon opens the same editor in
  every view, including the Spaces tab strip and arranged window headers; a
  phone has the appearance button in its terminal app bar. The
  header shows the native Herdr tab name, with **Save name** calling its current
  connection's `tab.rename`. Tab colour and a 160-character manual status are
  shared across split panes; each pane can choose an existing bounded sprite
  avatar. Board shows icon/status, Town shows the character/desk callout, Spaces
  shows icon/status tooltip and Desk shows the same choices. Resets restore
  existing defaults, and failed saves preserve their drafts. Workspace icons
  and status messages are outside these controls. Complete current observations
  reclaim settings for closed terminals; unavailable hosts retain their settings.
  Runtime status badges retain
  their system colours and meanings.
- **Terminal colours.** Every tab has one colour, shown as the tab in Spaces,
  the card in Board and its table in Town (tabs beyond a room's drawn tables
  show it in Spaces and Board). Colour is quiet identity, never attention: the
  palette's eight tones are muted and equally light, so only status (the agent
  marks, each with its own glyph) uses loud colour. A tab without a colour of
  its own shows its room's: the workspace's chosen colour, or else the room's
  stable default, so a room reads as one colour and only rooms differ by
  default. Choose another from the terminal's icon in its
  window header or the appearance button in the phone terminal's app bar, the
  terminal window's menu (**Colour**), the tab's menu in Spaces, the swatch in
  an agent's peek in Town, or the selected card in Board, and reset a tab's own
  colour with **Default colour** the same way. Herdr has no tab colour, so the World service
  saves the choice by immutable connection and Herdr tab ID, with terminal-ID
  continuity evidence after migration. A reused tab ID cannot inherit a bound
  choice. Legacy colours acquire their initial evidence from complete current
  observation; their earlier identity cannot be reconstructed. A closed tab's
  saved colour is dropped.
  - Workspaces and hosts have colours too. A workspace's colour is its Town
    room's carpet (swatch beside the room's name), its Board card and a dot in
    the Spaces sidebar (its menu offers the palette); its tabs without a colour
    of their own take it. A host's colour is its Town building's roof (swatch on
    its reception board), its Board zone (swatch on the zone label) and its
    Spaces header; it is not passed on to tabs. **Default colour** returns a
    place to its own default.
  - A desk moved to another room keeps a colour picked for it. Without one it
    takes its new room's colour, like every desk there.
  - A spawned agent's tab without a colour of its own takes the colour of the
    tab that spawned it (before its workspace's colour), and keeps following it
    when moved. A chosen colour always wins.
  - The existing agent CLI colour command binds the current tab occupant too.
    Undo compares that binding as well as its colour. An older undo that cannot
    establish continuity is refused; set the desired colour explicitly instead.
