# Shell Navigation notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- View picker and canonical /town, /board, /desk, /spaces routes reach the four views.
- The shared navigator, tab strip, Hosts filter, Actions and Find or act work across views.
- Phone navigation, Zen, Back, transient menus and mobile shell commands share that frame.
- TUI/core use the same shell; unsupported target actions explain their runtime capability.

**Code:**

- `web/src/shortcutCheatSheet.ts`
- `web/src/shortcutCheatSheet.test.ts`
- `web/src/shortcutPreferences.ts`
- `server/src/config/ui-settings.test.ts`
- `web/src/useAllServerAgentSessions.ts`
- `web/src/useAllServerAgentSessions.test.ts`
- `web/src/layerStack.browser.test.ts`
- `web/src/components/MobileControls.tsx`
- `web/src/App.tsx`
- `web/src/world/WorldTerminalHandoff.test.ts`
- `web/src/world/WorldFoundationApp.tsx`
- `web/src/world/visualRouteActions.ts`
- `web/src/world/worldSearch.ts`
- Find any agent: `web/src/world/worldCommandBox.tsx`, `web/src/components/CommandCombobox.tsx`, `web/src/components/CommandActionItem.tsx`, `shared/harnessLabels.ts`
- Found herdr-core terminal in Spaces: `web/src/world/SpacesCoreTerminal.tsx`, `web/src/world/spacesCore.ts`, `web/src/world/spacesCoreTerminal.css`
- `web/src/layerStack.ts`
- `web/src/world/runtimeGrouping.ts`
- `web/src/world/runtimeGrouping.settings.tsx`
- `web/src/world/useHostGroups.ts`
- `web/src/world/navigatorGroups.ts`
- `web/src/world/WorldNavigator.tsx`
- `web/src/worldHosts.ts`
- `web/src/store/uiSettings.ts`
- `server/src/bridge/settings-rpc.ts`

**Tests:**

- `web/src/world/WorldFoundationApp.test.ts`
- `web/src/world/visualRouteActions.test.ts`
- `web/src/world/worldSearch.test.ts`
- Find: `web/src/world/worldCommandBox.test.tsx`, `web/src/commandBoxKey.dom.test.ts`, `web/src/foundTerminalReveal.dom.test.ts`
- `web/src/systemBack.browser.tsx`
- `web/src/world/runtimeGrouping.test.ts`
- `web/src/world/navigatorGroups.test.ts`
- `web/src/worldHosts.test.ts`
- `server/src/bridge/runtime-grouping-schedules.test.ts`
- `server/src/bridge/settings-rpc.test.ts`

**Pitfalls:**

- The Hosts filter is not the operational connection selector.
- Actions capture the explicit entity; hidden Spaces focus must never supply a target.
- Retired Office/Graph/Tree routes redirect without creating a Back loop.
- No shell-navigation CLI exists; connection CLI ownership is in runtime-federation.

## Usage reference

- **Spaces** is the focused operational workspace: terminals, files, changes,
  annotations, worktrees, and Agent History for one selected connection.
- **Town**, **Board** and **Desk** show the aggregate of local and SSH hosts.
  **Hosts** (in the top bar; on a phone in Zen, in the corner view menu too)
  defaults to All hosts and persists an explicit host set independently
  of **Manage connections**; both places show and change one filter per
  browser. It lists one row per machine (this computer or one SSH
  destination, as Town's buildings), Herdr TUI and herdr-core together, named
  by its first runtime: `<name> · ready`, or `<name> · 1 of 2 reconnecting`
  when its runtimes differ. Checking or unchecking a machine covers all its
  runtimes; the count and "N hosts" count machines. Unchecking the last
  checked machine leaves **No hosts** (an empty selection, kept on reload);
  **All hosts** brings everything back. The selection is saved
  as connection IDs (`web/src/world/hostsFilter.ts`), so one saved before
  #1227 shows its whole machine (`hostsFilterByMachine` in
  `web/src/worldHosts.ts`). Each runtime's own state stays in **Manage
  connections**. Filtering preserves open resources and terminals;
  removed saved identities are pruned, with an explained return to All hosts
  when none remain. Offline hosts keep labelled roots; an empty catalogue offers onboarding.
## Workspace, Tab, and Pane Navigation

- Browse workspaces and recognized agents; create, rename, focus, pin, or close
  workspaces and create, rename, colour, switch, or close tabs.
- Group linked Git worktrees under their repository. Pin workspaces/worktrees
  to the top and collapse groups; preferences stay in this browser.
- With more than one server connected, the Spaces workspace list's heading
  switches between **Current** and **All servers**. All servers lists every
  ready connection's workspaces and agents from World's shared observation,
  labels each with its server and keeps worktrees nested. Selecting a row opens
  its server; another server's menu only navigates. Stale hosts stay out, and a
  failed observation shows its error.
- **Settings → This World → Group runtimes** decides how Town's buildings,
  World's navigator, Desk's other-host summaries and Board's zones group a machine's
  runtimes, for every browser. **One per machine** (the default) puts this
  computer's Herdr TUI and herdr-core under one navigator heading with a
  **Herdr TUI** row and a **herdr-core** row (each with its own tree, colour
  and actions), one Town building, one Desk host and one Board zone; **One per runtime** shows
  each runtime apart. A machine on its own runtime keeps a plain host row.
  The value lives in the service's settings (`ui.runtimeGrouping`), with a
  browser copy (`runtimeGrouping.v1`) for the first paint; one browser's
  earlier Town buildings choice moves there once, as an `only_if_absent`
  update the service applies inside its settings writer. Answers and pushes
  carry the service's commit `revision`; a browser keeps the newest one it
  has seen, so a late push never undoes a later save. Groups come from one
  derivation (`worldHostGroups` / `hostGroupOf` / `groupByRuntime` in
  `web/src/worldHosts.ts`); the Hosts filter always lists machines.
- Workspace rows show numbered tab chips with each tab's agent status, folding
  extra tabs into **+N**, and keep the server badge in the right column. In
  Spaces a chip focuses its tab; in World's navigator it selects the workspace
  without moving Herdr's focus.
- Split panes right/down, resize boundaries, focus neighbors, zoom, or close.
  Drag a pane handle onto another tab in the same workspace, onto a pane edge
  in that tab, or onto **+** to break it into a new tab. Hover a tab to open its
  panes before dropping. Overflowing desktop tab strips offer scroll controls.
- Search workspace, worktree, file, tab and pane actions in the command
  menu (`Cmd+K` on macOS, `Ctrl+K` elsewhere, or `Cmd+Option+K`/`Ctrl+Alt+K`
  from a terminal or text field). A workspace-relative or
  absolute path opens the file. Agents are found in its **In World** group,
  in every view (see Find or act in terminal-windows notes); Spaces has no
  separate list of its own connection's agents. Enter on a herdr-core agent
  shows its terminal in Spaces' terminal area in place of the Herdr tab
  (`web/src/world/SpacesCoreTerminal.tsx`); **Close** returns to the tab.
  Every terminal a find opens closes an expanded Inspector (or any Inspector
  on a phone) first, through App's `revealTerminal` request.
- Toggle **Zen mode** (`Cmd+Shift+Z` on macOS, `Ctrl+Alt+Z` elsewhere) to hide
  the topbar, tab strip, and sidebar and run the terminal flush to the window.
  Hovering the Exit Zen tab slides the topbar back, and it stays while one of its
  menus is open. The sidebar still toggles inside Zen and returns to its prior
  state on exit; split layouts keep pane borders. Every World view opens in
  Zen by default, with one choice shared by Town, Board, Desk and Spaces; the
  settings menu's **Zen mode** switch turns it off or back on. While Zen is on,
  a view picker beside Exit Zen switches between the views. On a phone, Zen
  hides the top bar and bottom navigation on every root screen, Spaces' list
  included; a corner button opens the views, **Hosts**, **Find or act** and
  **Show the bars**. **Hosts** there opens the top bar's Hosts filter in the
  menu's place, with **Manage connections**, and changes the same selection;
  Tab moves between its controls, and Tab out of it closes it, as Tab closes
  the views menu. On a short screen the menu scrolls, so every choice stays reachable.
  A terminal is a detail screen and keeps its own bar, with Back. Stored in
  this browser.

Herdr 0.9.0 uses **Local navigation** per browser/connection; legacy connections
use **Shared navigation**. Reconnect preserves live selections; reload starts
from Herdr's selection. Closing/moving a selected pane selects a remaining pane
in its tab, then a remaining tab/workspace. Topology changes, terminal sizes,
and same-tab pane focus (including `follow` cwd) remain shared.

Creation preserves Herdr's cwd policy and needs an open, connected source
terminal tab; unavailable sources show an error. An empty session can create its
first workspace directly. See [compatibility](../../../../docs/DEPLOYMENT.md#herdr-compatibility).

### Recent Pane Switcher

The switcher includes the 12 most recently focused live panes plus the current
layout, across tabs/workspaces. Entries show workspace, tab or cwd, and agent
icon/status. Closed panes leave history automatically. The keys below use the
macOS preset; see [other platform bindings](notes.md#keyboard-shortcuts).

| Key | Action |
| --- | --- |
| `Ctrl+Tab` | Open at the previous pane; hold Ctrl and repeat Tab to advance |
| `Ctrl+Shift+Tab` | Move backward |
| `Up` / `Down` | Move through entries |
| Release `Ctrl` or press `Enter` | Switch |
| `Esc` | Cancel |

### Pane Search

`Alt+K` opens search over every live pane on the selected connection, including
panes absent from the recent switcher, and agents on the other ready servers;
choosing one of those opens its server's pane. Filter by workspace, tab, cwd,
agent name, or status. Search terms can appear in any order and must all match;
results retain their recent-first order. Use Up/Down or Tab/Shift+Tab to choose,
Enter to switch, and `Alt+K` or Esc to close. Releasing the opening modifier
does not commit a search selection. Press K in the recent switcher to convert it
to search.

## Mobile and PWA

- Town Chat controls have 44 × 44 px touch targets on phones, including
  buttons drawn smaller than their tap area.
- In an ordinary mobile shell terminal, **Agent terminals** beside Message
  launches an agent in that pane with Enter. Start with an empty shell prompt
  and draft. The pencil edits each command, including arguments or an executable
  not detected on the host; preferences stay in this browser per connection and
  agent. **Reset** restores the detected default. A failed send keeps the command
  in Message. Existing agent and pad terminals do not offer the launcher.
- List panels use the command picker's borderless rows, compact headings and
  selection highlights. World's shared top app bar and managed-window Tabs
  sheet keep their existing navigation and window-restoration behavior.

The Message editor sits below each terminal in normal layout flow. Tap it to
raise the keyboard and compose; Direct explicitly enables raw terminal input.
Tabs and More stay in World's shared top app bar. If an upload finishes after its
Direct destination retires, World keeps the path in the original Message draft
and reports the failed insertion instead of sending it to another pane.

- Responsive terminals, Inspector, and viewport/keyboard handling. **Settings →
  Appearance → Layout → Display mode** offers Automatic/Mobile/Desktop.
  Automatic uses **Mobile up to (px)**: 768 by default, adjustable 320–2560 CSS
  pixels. Mobile stays mobile at any width, including after reload.
- URL overrides `?layout=mobile`, `?layout=desktop`, or `?layout=auto` beat saved
  mode. Choosing a menu mode clears that override, preserving other parameters.
- Choose **Agents on top** or **Workspaces on top** independently for each layout
  under Layout Preferences. This affects the separate Agents panel; mobile defaults
  to agents first, desktop to workspaces first.
- Touch taps and swipes read terminal output without opening the device keyboard.
  Use the bottom-right **Open device keyboard** button to type directly; a light
  touch tap on the terminal dismisses it without sending input. Scrolling keeps
  input active. Mouse selection and physical-keyboard input work in either layout.
- Long-press a word directly in the terminal, drag either selection handle, then
  **Copy** or **Add comment**. Copy keeps the selection; **Done** or Escape returns
  to reading without opening the keyboard. Scroll before selecting older output:
  touch handles cover the displayed viewport. Output stays connected and the
  displayed frame freezes until selection ends, then shows pending output.
  Legacy incremental streams resume automatically at a 1 MiB buffered UTF-16
  payload limit without discarding output or a captured comment.
- Configure the floating terminal panel's `2×8` shortcut grid and up to four
  side buttons. Empty editor slots keep their positions but compact at runtime.
  Actions include Ctrl, arrows, Enter variants, full/half-page scrolling, and
  Paste (text or uploaded clipboard-image paths).
- Switch split panes or use the Tabs sheet to create/switch/close tabs when the
  strip is hidden. The composer supports native IME, dictation, multiline text,
  and images: **Insert** does not execute; **Send** adds exactly one Enter.
  Drafts stay in memory per connection/pane; closing their pane/tab/workspace
  asks before discarding them.
- A bundled glyph-only Nerd Font supplies common terminal icons. Install as a
  PWA in iOS/iPadOS Safari, macOS Safari, Chrome, or Edge to remove browser chrome.
  It still needs a reachable Herdr World process, not offline access. Use **Settings →
  Reload page** in the browser or PWA.

Mobile shortcuts and appearance stay in this browser, not Herdr configuration.

## Keyboard Shortcuts

Open **Settings → Keyboard → Keyboard shortcuts** for the searchable
list and preset editor on desktop/mobile. Lists and hints show active bindings.
See the [desktop](../../../../docs/screenshots/keyboard-shortcuts-desktop.png) and
[mobile](../../../../docs/screenshots/keyboard-shortcuts-mobile.png) editors.

- **Automatic** detects macOS/iOS, Windows, or Linux/Android; explicit presets
  override detection.
- **Edit** records/types up to three alternatives, restores defaults, or unassigns
  an action. Editing built-ins creates a custom copy. Overlapping conflicts are
  rejected while ordinary typing, IME, and dialog dismissal stay available.
- **Save as** creates named presets; **Active preset** switches them. Edits save
  immediately on the World service and follow you to every browser, even
  while the selected Herdr connection is offline. A custom preset applies only
  on the platform it was written for; elsewhere that platform's defaults
  apply. **Export/Import** transfers presets as JSON; deleting a custom preset
  returns to Automatic.
- Letter/number bindings use physical keys, unaffected by modifier-produced
  characters. Recording captures only keys the page receives; choose alternatives
  for browser/OS-reserved shortcuts, including macOS tab shortcuts.

Common defaults (Linux/Android overrides follow the table):

| Action | macOS / iOS | Windows / Linux / Android |
| --- | --- | --- |
| Command menu | `Cmd+K`; `Cmd+Option+K` in a terminal or text field | `Ctrl+K`; `Ctrl+Alt+K` in a terminal or text field |
| Sidebar | `Cmd+B` | `Ctrl+Alt+B` |
| Workspace Inspector | `Cmd+Shift+B` | `Ctrl+Alt+Shift+B` |
| Expand / restore Inspector (desktop) | `Cmd+Option+Enter` | `Ctrl+Alt+Shift+Enter` |
| Annotations | `Cmd+Option+A` | `Ctrl+Alt+A` |
| Zen mode | `Cmd+Shift+Z` | `Ctrl+Alt+Z` |
| Recent pane switcher | `Ctrl+Tab` | `Ctrl+Alt+J` |
| Pane Search | `Alt+K` | `Alt+K` |
| Search the current view (Town, Board, Desk) | `/` or `Cmd+F` | `/` or `Ctrl+F` |
| Create / close tab or pane | `Cmd+T` / `Cmd+W` | `Ctrl+Alt+T` / `Ctrl+Alt+W` |
| Previous / next tab | `Cmd+Option+Left/Right` | `Alt+Shift+Left/Right` |
| Focus neighboring pane | `Cmd+Ctrl+Arrow` | `Ctrl+Shift+Arrow` |
| Split right / down | `Cmd+D` / `Cmd+Shift+D` | `Ctrl+Alt+D` / `Ctrl+Alt+Shift+D` |
| Zoom / restore pane | `Cmd+Shift+Enter` | `Ctrl+Alt+Enter` |
| Arrange Single / Cascade / Columns / Rows / Grid / Restore | Unassigned; use Actions or set custom keys | Unassigned; use Actions or set custom keys |
| Numbered tab | `Ctrl+1…9` | `Ctrl+Alt+1…9` |
| Numbered command menu action | `Option+1…9` | `Alt+1…9` |
| Workspaces | `Ctrl+Shift+W` | `Ctrl+Alt+O` |
| File Explorer | `Cmd+Shift+E` | `Ctrl+Alt+E` |
| Diff Viewer | `Ctrl+Shift+G` | `Ctrl+Alt+G` |
| Agent chat | `Cmd+Shift+H` | `Ctrl+Alt+H` |
| Search raw preview / diff | `Cmd+F` | `Ctrl+F` |
| Send composer / add review comment | `Cmd+Enter` | `Ctrl+Enter` |
| Copy terminal selection | `Cmd+C` | `Ctrl+Shift+C` / `Ctrl+Insert` |
| Terminal paste | `Cmd+V` | `Ctrl+V` (also `Ctrl+Shift+V` on Linux) |
| Open terminal links / file paths | `Cmd+Click` | `Ctrl+Click` |

Linux/Android uses `Ctrl+Alt+Shift+T` to create tabs, `Ctrl+Alt+Shift+D` to
split right, and `Ctrl+Alt+Shift+S` to split down, avoiding common Linux desktop
shortcuts for launching a terminal or showing the desktop.

Terminal copy, page/half-page navigation, and modified Enter are configurable
here. Copy needs a selection; plain `Ctrl+C` remains terminal input. Native text
editing, editor search, and shell/agent keys follow those apps. Native clipboard
gestures remain; remapped paste needs the browser Clipboard API. Touch controls
use the separate **Mobile terminal shortcuts** editor.

Esc dismisses dialogs, menus, notifications, and update banners. Tab/arrows
navigate controls. The pane switcher accepts Up/Down, Enter, or release of its
opening modifier. Diff search uses Enter/Shift+Enter for next/previous. Select in
mouse-aware apps with Option-drag (macOS) or Shift-drag (elsewhere).

## Shortcut cheat sheet

On desktop, open the searchable, read-only overview of your active shortcut preset
with Cmd+Shift+K on macOS or Ctrl+Alt+Shift+K on Windows/Linux, the top-bar command
icon, Actions, or Settings → Shortcut cheat sheet. Numbered actions collapse into 1–9
rows. Customize assignments in Settings → Keyboard shortcuts.
