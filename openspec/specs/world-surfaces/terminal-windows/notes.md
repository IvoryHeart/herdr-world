# Terminal Windows notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Tab-bar arrangements, shell Actions, optional shortcuts and window headers share window operations.
- Single/Cascade/Columns/Rows/Grid/Restore, maximize/resize and Close/Open all have distinct scope.
- Phones show one active window with Back/Tabs/overflow while keeping desktop geometry.
- TUI/core keep the same qualified presentation ownership; native split/layout support differs by runtime.

**Code:**

- `web/src/visibleTabLayout.ts`
- `web/src/visibleTabLayout.test.ts`
- `web/src/components/WorkspaceInspectorHost.tsx`
- `server/src/bridge/terminal-bridge.test.ts`
- `web/src/world/windows/windowManager.ts`
- `web/src/world/terminalWindowArrangement.ts`
- `web/src/world/useSpacesTabWindowArrangement.tsx`
- `web/src/components/WindowArrangementMenu.tsx`
- `server/src/bridge/terminal-bridge.ts`

**Tests:**

- `web/src/world/windows/windowManager.test.ts`
- `web/src/world/terminalWindowArrangement.test.ts`
- `web/src/world/WorldTerminalHandoff.test.ts`
- `web/src/world/useSpacesTabWindowArrangement.browser.test.ts`

**Pitfalls:**

- Close all dismisses World presentations, not native tabs or processes.
- Arrangements act once on current participants; later windows retain normal admission.
- Restore geometry is distinct from live ownership and Spaces workspace-local placement.
- Hidden Spaces cannot retain a second attachment; handoff detaches before admission.
- There is no arrangement CLI; native CLI tab moves do not arrange browser windows.

## Usage reference

- One set of agent marks, each with one glyph, colour and word, in Town, Board,
  Desk, Chat and the phone bar: • Working, ! Needs you, ? Asks you, ✓ Done,
  – Idle or Reviewed, ~ No signal, × Offline (`web/src/world/agentMarks.ts`).
- Inspectors and terminals capture their own host, runtime generation and resource
  identity. Focus and filters cannot retarget them. Global creation confirms one
  destination; room creation inherits its room. Notifications outside the filter
  open a labelled Inspector with an explicit Reveal in Hosts action.
- Open Inspectors, terminal buffers, split geometry and same-runtime Message
  drafts survive browser transport disconnects, including mobile backgrounding.
  When a connection reconnects to the same destination, an unsent draft moves
  to the same terminal in the new runtime. Drafts stay in memory only, so a
  reload starts empty.
  Last observations show a disconnected indicator and stay non-actionable until
  fresh admission. Terminal recovery offers **Retry terminal** and an explicit
  **Reload app**; a no-frame watchdog never reloads the page automatically.
- Search covers observed entities beyond renderer limits and pages matching results.
  Every view's search matches each word of the query in any order and any
  case, as Pane Search does: `builder login` finds the builder agent whose
  task mentions login, in Town, Board and Desk alike. Each result shows its
  type (building, room, table, agent or terminal), its name and status mark,
  and its place (`host › room › table`), so twins on different hosts are told
  apart. Names come first, then places, then task-summary matches, which show
  a short excerpt with the matched words picked out. On Board the results
  float over the top of the board and its count matches the list; **Down**,
  **Up** and **Enter** pick and select a result, and **Escape** ends the
  search.
  Counts distinguish observations, rendering omissions and unavailable coverage.
- Use **Arrange windows** in the shared shell to show the active terminal alone,
  cascade open windows, fit them in columns or rows, tile them in a grid, or
  restore their previous positions. Spaces arranges the focused workspace's
  existing tabs; visual views arrange their open, non-minimized Inspectors. The desktop controls sit in the top bar; mobile puts it in the ellipsis-expanded controls. The same
  placements are in **Actions** and can be given custom keyboard shortcuts;
  none are assigned by default. Layout
  choices that cannot fit explain why.
- Inspectors and arranged Spaces windows share snap, minimize, maximize/restore,
  close and all eight resize handles. Each window has one bar: its name, a
  location line, the view selector and **⋯**, **− Minimize**, maximize and close. An agent is
  named `<name>-<harness>` (for example `otter-claude`), shortened in the middle
  past 14 characters, and its state is a badge on its icon: a tick when done, a
  spinner while working, **!** when it needs you and a grey dot when idle. **⋯** holds
  a minimize shortcut, the snap choices and float. **Fit right** and **Fit left**
  come first: they put the window against that edge, full height, at its normal
  docked width (520 px, at most half the screen, or the width you last dragged a
  docked window's inner edge to) and leave the rest of the view usable; the half
  and quarter snaps still fill their region. A fitted window keeps its inner-edge
  resize handle. The same two placements are in **Actions** for the active window
  and can be given keyboard shortcuts; none are assigned. Phones have no fit
  choices because windows fill the screen there. Tapping the location line under the name
  shows the branch, worktree and PR status, replacing the card above Changes. In
  Town the window takes the Town look (portrait, pixel name, chunky buttons,
  **‹ Back**), and so does its Chat: Town's colours, framed messages with
  yours in soft gold, raised keys, a soft gold **Send** and the agent's
  recommended answer in the same gold. On touch screens or without a pointing
  device, narrow Town columns keep 40px window controls; the pane map hides to
  leave room for the agent's name. On a phone the window fills the screen like the
  terminal: its bar shows the name and status, and **⋯** switches the view
  (Chat, Terminal, Changes, Files) or switches to another agent or terminal. Opening or focusing a window preserves other
  placements; snapping into an occupied region overlaps without rearranging it.
  Tiled windows share resizable dividers. **Open windows** restores minimized windows.
  **− Minimize** stays visible on phones. There, a minimized window waits as a
  chip at the bottom left of Town or Board, above the bottom controls and also
  in Zen: one tap on the chip restores it. While another window fills the phone
  screen, the chips sit in a strip at the bottom of that window, below its
  content, so a minimized window is still one tap away; its **⋯** and **Tabs**
  in the expanded mobile controls also list windows.
  **Close** (or **‹ Back**) dismisses
  the window; open the agent or terminal again to reopen it. Minimizing or
  closing a window leaves agents and terminal sessions running. Native tab
  closure remains separate.
- Menus, dropdowns, pickers and the workspace list opened from a terminal's
  title close top first: Escape and Back close only the topmost one; a press
  or tap outside all of them (on the terminal, say) closes them all, so one
  tap shows the terminal, and a press inside a lower one closes only those
  above it. Escape, Back or a choice returns
  focus to where it was, such as the terminal. The phone's Tabs sheet
  and Composer close with the phone's Back.
- Mobile shows one active window and preserves desktop positions. The on-screen
  **Back** first closes an open menu or the workspace list (opened from the
  terminal's title), then returns from a terminal to the visual view even with
  Composer open; the phone's own Back closes Composer first, then the terminal. Tabs and More stay in the shared top app bar; More exposes Arrange windows.
  Tabs also restores minimized windows and retains native tab actions. The duplicate
  list icon and mobile tab strip are hidden. The outer shell coordinates terminal sizing with the keyboard viewport.
- A Spaces tab window shows that tab's Herdr split panes. An Inspector in a visual
  view also shows the selected tab's split panes in one window; selecting a sibling
  pane keeps the same Inspector and updates its pane-specific resources. A
  multi-pane tab's window title starts with a drawing of its split (the shown
  pane in the accent colour, a pane that needs you in yellow); one tap opens a
  map of Herdr's real layout and tapping a pane switches Chat, Terminal and the
  rest of the window to it without moving Herdr's own focus. When the
  Spaces Inspector is on Terminal, **Focus tab window** goes to the active tab
  without attaching a second terminal.
- A failed host may retain its last observed topology as visibly stale,
  never actionable. Selecting a live entity revalidates its connection generation
  before opening the same terminal or host-specific Inspector context.
- A slow host does not hold back another host’s controls: World returns a
  complete host list within 20 seconds, marks unfinished host views stale, and
  refreshes them when their observations complete.
- The **Actions** command menu stays at the right of the top bar in every view
  (`Cmd+K` on macOS, `Ctrl+K` elsewhere). Use it for workspace/tab creation,
  window arrangements and the selected target's available resource actions.
  Check the selected host and target before acting. A host, generation or
  observation change invalidates an open target; Actions does not send input
  or assign tasks to an agent.
- In Town, Board and Desk the command menu is also World's command box. Type
  and it finds buildings, rooms, tables, agents and terminals as the views'
  search does, each with its status mark and place (`host › room › table`);
  **Enter** or a click selects it as clicking it in the view does. It also
  goes to another view. In Zen it opens from the **⌘** button beside the
  view buttons; on a phone, from **Find or act** in the corner view menu. In
  a terminal, the Chat composer or a text field `Ctrl+K` and `Cmd+K` stay
  shell and editor keys; `Ctrl+Alt+K` (`Cmd+Option+K` on a Mac) opens the box
  from there.
- World runs as one application and one browser origin. No remote World/Roamgate
  service or browser bridge URL is required for an SSH host.

## Full Browser Terminal

- Display Herdr's server-rendered terminal at browser rows/columns, with splits.
- Send normal input, modified Enter, macOS line-editing shortcuts, multiline
  paste, IME composition, and rapid CJK punctuation.
- On desktop, click terminal output to use physical arrow keys and Ctrl
  combinations, including after opening an agent's Message or switching views.
  The phone-only Composer does not disable desktop input or discard its draft.
  On phones, side-by-side keyboard (Composer) / terminal (Direct) icons stay
  accessible while editing an expanded draft; Direct hides and saves it, and
  Composer restores it. Special keys remain visible in both modes.
  The separate `/ Commands` control inserts command suggestions into the draft.
- Scroll history by wheel, trackpad, touch, or half-page
  `Alt/Option+Page Up`/`Page Down`. Full page keys go to terminal apps (such as
  nano) or Herdr history when the shell owns them; mobile buttons route the same
  way. Endpoint history needs advertised support; disabled controls explain why.
  Explicit half-page shortcuts remain history actions in mouse-aware apps.
- On Herdr 0.9.0, clicks/drags/wheels use pane-local cells in mouse-aware apps.
  Select browser text with Option-drag (macOS) or Shift-drag (elsewhere);
  ordinary output needs no modifier. Selection pauses visible endpoint output
  until cleared, then catches up. Drag past pane edges to scroll and copy
  offscreen rows. Release or blur stops scrolling; if output changes, finish
  the selection before scrolling further. Pixel mouse is unsupported.
- On macOS, **Settings → Keyboard → Option key as Alt**
  makes Option send Alt-modified keys instead of typing characters such as @,
  [ and ~. It is off by default and saved in this browser.
- Paste clipboard images to upload to the Herdr host and insert their paths,
  including through `--ssh-host`. When a composer sends an uploaded image's
  path, the path goes to the agent on its own and Enter waits for it, so Claude
  Code attaches the image instead of dropping the message.
- Native `Ctrl+V` (`⌘V` on macOS) pastes text or files even on plain-HTTP LAN
  addresses. On plain-HTTP addresses, a configured `Ctrl+Shift+V` on Windows
  and Linux also uses the browser's native plain-text paste where supported;
  use `Ctrl+V` or drag and drop for images.
  Over HTTPS or localhost it keeps async clipboard reads, including images.
  Other custom paste shortcuts need clipboard access over HTTPS or localhost;
  when unavailable, World explains how to use native paste, drag and drop, or
  a secure address.
- Every composer that attaches files (the phone Composer, Spaces, the Town peek
  and Inspector Chat) shows a chip per file: uploading with byte progress, then
  done or failed. A failed file can be retried, by **Retry** or by picking it
  again, or removed. Send waits until uploads finish, and picking a file again
  while it uploads does not upload it twice. A path that finishes after its
  composer closed joins the draft when that composer opens again.
- Drag a file or directory path from the File Explorer into a terminal to
  insert its quoted host path. Terminal font size is adjustable independently
  of interface scale in **Settings → Appearance**. **Chat text size** there sets Chat's
  text size: it follows the terminal font size until changed, and its value
  button links it back.
- Show Herdr session popup panes over the active workspace when a plugin opens
  a modal interaction. A plugin popup first focuses Herdr on the Space it was
  opened for, so it shows where you are looking even when Herdr's own focus
  was elsewhere.
- **Shell** in an agent's Town or Board peek (on a phone: Board → tap a card →
  **Preview**) opens its room's floating shell, on either runtime. On Herdr it
  toggles the [Herdr Float](https://github.com/meerzulee/herdr-float) plugin
  in the agent's Space and folder, exactly as `Ctrl+Alt+F` does; without that
  plugin installed in Herdr, World shows Herdr's refusal. On herdr-core, which
  has no plugins or popups, World runs its own float shell instead (see
  herdr-core connections below).
- Switch back to a recently viewed pane without waiting: the service keeps up
  to 20 recently viewed terminal streams open for 10 minutes without viewers.
  They belong to their connection's runtime and close with it.
- Relay terminal OSC 52 clipboard writes. Herdr 0.9.0 follows the foreground
  recipient, not proven originating-pane ownership; see
  [clipboard compatibility](../../../../docs/DEPLOYMENT.md#herdr-compatibility). A write
  made by a command that a composer sent returns to the browser that sent it,
  on the same connection and terminal. Clipboard reads stay refused.
- `Cmd/Ctrl`-click HTTP(S) links to open safely in a new tab, or workspace-relative
  / absolute paths to preview text, Markdown, or images. Wrapped paths remain
  one link, including indented continuations in agent output. Windows drive and
  backslash paths are recognized too. On Herdr 0.9.1, wrapped terminal links
  resolve against visible rows; OSC 8 links retain their explicit destinations.
  Older Herdr versions keep local URL/path detection.
- On a touch screen, long-press a link or path and choose **Open link** or
  **File actions**. This works in every view's terminals, while an agent keeps
  repainting its status line and while the Composer is open. A URL found in the
  text stays offered while its row shows the same text; a labelled OSC 8 link
  is withdrawn when a new frame arrives. These actions work in Town and Board
  managed Inspectors as well as Spaces, including with Composer open. Progress
  on adjacent hard rows does not expire an unchanged URL. Repeated window
  activation preserves a freshly verified OSC 8 target only at the same cells
  and frame.
