# Window chrome: one bar per window (FM-DESIGN phase 1)

Design proposal for review. Nothing in the application changes in this PR.
Open [`prototype.html`](prototype.html) from a checkout. It switches between five
viewports and Town, Board and Spaces, and flips each between the real capture
from `main` and a live mock of the proposal. All data is synthetic.

Captured on `main` at `70dd4de7`, with Herdr 0.9.3 in a throwaway session,
disposable demo repositories, a synthetic shell prompt and headless Chromium.
`img/` holds the before captures and `after/` the rendered mocks.

## The problem

Every World window stacks three bars above its content:

1. **Identity and controls.** Kind and state ("AGENT · WORKING"), name, then
   snap, minimise, maximise and close. The docked Inspector adds dock side,
   expand, float or pop-out. #261 adds a colour swatch.
2. **Views.** Terminal, Files, Changes (with a count), Commits and Chat.
3. **Branch link.** A row holding one icon that opens PR status. Changes and
   Commits then add a 58px "PR/MR status" card under it.

That is 119px in every viewport, and 177px of a 520px window on Changes. Around
the windows, Town reserves the app top bar, the Spaces tab strip and the sidebar.

| Viewport (CSS px) | Top chrome above Town | Sidebar | Window bar | Window on Changes |
| --- | --- | --- | --- | --- |
| Phone 390 × 844 | 61 (+ 75 bottom nav) | none | 61 (already one bar) | 61 |
| Mac laptop 1440 × 900 | 124 | 306 | 119 | 177 |
| Half-width Linux 1270 × 1300 | 124 | 306 (24% of width) | 119 | 177 |
| Wide Linux 2560 × 1300 | 124 | 306 | 119 | 177 |
| Portrait 1080 × 1800 | 130 | 306 (28% of width) | 119 | 177 |

On phone, the Town camera stack (+, −, ALL and ⋮) takes 56 × 190px over the map.

Zen mode (`Ctrl+Alt+Z`) already hides the top bar, tab strip and sidebar, but
only on desktop. `App.tsx` gates it on `!mobile`, so on phone it changes nothing.

### Controls, frequency and new home

| Bar | Control | Use | New home |
| --- | --- | --- | --- |
| 1 | Kind · state | glance, always | Coloured dot and word at the start of the location line |
| 1 | Name, icon | always | Name; the avatar's ring is the terminal colour |
| 1 | cwd / task / location | sometimes | Location line (room · desk · branch); full detail in its popover |
| 1 | Snap menu, float | sometimes | ⋯ menu, plus dragging to the edges |
| 1 | Minimise | sometimes | ⋯ menu |
| 1 | Maximise / restore | often | Double-click the bar. Town: ⋯. Calm: a button. |
| 1 | Close | often | Town: ‹ Back. Calm: × |
| 1 | Dock side, expand, pop-out terminal | rare | ⋯ menu |
| 1 | Colour swatch (#261) | rare | ⋯ → Colour; shown as the avatar ring or swatch |
| 1 | Repository status icon | sometimes | Location popover (it duplicated bar 3) |
| 2 | Terminal · Files · Changes · Commits · Chat | constant | One top selector in the bar, phone included (Commits stays in Changes' own toolbar) |
| 3 | Branch-link row | rare | Removed; the location popover covers it |
| 3 | PR card on Changes and Commits | sometimes | Pill in the Changes toolbar, plus the popover |

## The design

**One bar, one frame, two skins.** A World-owned `WindowBar` renders inside
`WindowFrame`, with slots for lead, identity, views, primary action and overflow.
Every window kind fills those slots instead of drawing its own head: the
Inspector, the Spaces tab window and the Town chat window.

- **Town skin** (Town v4 prototype): dark translucent panel with a 2px edge and
  soft shadow, 40–44px targets, and the name in Pixelify Sans. The bar is
  `‹ Back · avatar · name / location line · [Chat | Terminal | Changes | Files] · Next › · ⋯`,
  58px in total. Selector chips are icons until the window reaches 640px, then
  labelled. Pane chips get a second row only when the desk has two or more
  panes. Only Chat has a bottom area: its composer.
- **Calm skin** (Board and Spaces): a 38px bar of
  `swatch · name · location line · view chips · ⋯ · maximise · close`.
- **Location line and popover:** shows status, host, room, desk and pane,
  branch, worktree, a copyable path and PR status. Branch and cwd stay out of the
  bar until asked for, like VS Code's breadcrumbs.
- **Overflow (⋯):** maximise (or double-click), minimise, snap, float or dock,
  open terminal window, colour and close. No control appears twice.

**Town shell.** Town hides the app top bar, the tab strip and the sidebar by
default, and the canvas runs full-bleed. A prototype-style HUD bar overlays it
12px from the top: ☰ and brand, counts with a **need you** pill, Jump to… `/`,
view, hosts and menu. ☰ opens Workspaces as a drawer over the map, and pinning
it is remembered per view. In Town, zen hides the HUD down to the need-you pill.
The Needs-you tray is a 216px left rail at 900px and up, and a bottom strip
below that. Desktop keeps the vertical +, −, ALL camera cluster, moved clear of
the dock. On phone it becomes one 44px fit button: tap fits the town, a long
press opens − and +, and pinch zooms.

**Board** keeps its sidebar preference and drops the tab strip, because tabs
are already cards on the board. That leaves a 44px app bar. **Spaces** merges
the app bar and tab strip into one 40px title bar with the tabs inside, as in
VS Code, Warp, Zed and iTerm2's compact theme.

### Viewport rules

| Viewport | Town dock | Window bar | Tray and camera |
| --- | --- | --- | --- |
| Phone | The window covers the screen; Back returns to the map; FirstMate is the other tab | ‹, avatar, name, the 4-icon selector and ⋯ (Next is in ⋯) | Bottom strip; view picker at bottom left; one 44px camera button; no bottom nav in Zen |
| Mac laptop | Right dock, `min(520px, 40vw)`; FirstMate and the agent are avatar tabs in the bar | Icon chips | Left rail; camera beside the dock |
| Half-width Linux | Right dock, 508px, with avatar tabs | As laptop | Left rail; hosts shown as an icon |
| Wide Linux | Right dock of 520px with avatar tabs; undock a tab to float it beside the dock | Icon chips; labels at 640px or wider | Left rail |
| Portrait | Bottom dock at 45% height and full width, with avatar tabs | Town skin, labelled chips | Left rail; camera above the dock |

The dock is the shared `WindowFrame` snapped right (owner decision Q9), so
windows can still be undocked, moved and resized.

### Pixels saved

| Viewport | Town top | Town sidebar | Window bar | Board top | Spaces top |
| --- | --- | --- | --- | --- | --- |
| Phone | 61 → 0 (overlay) | none | 61 → 58 | unchanged | unchanged |
| Mac laptop | 124 → 0 | 306 → 0 | 119 → 58 (Changes 177 → 58) | 124 → 44 | 124 → 40 |
| Half-width Linux | 124 → 0 | 306 → 0 | 119 → 58 | 124 → 44 | 124 → 40 |
| Wide Linux | 124 → 0 | 306 → 0 | 119 → 58 | 124 → 44 | 124 → 40 |
| Portrait | 130 → 0 | 306 → 0 | 119 → 58 | 130 → 44 | 124 → 40 |

The calm window bar goes from 119 to 38 (from 177 to 38 on Changes).

## Coordination

- **#261 (layers, colour swatch), merged.** Phase 2 moves its
  `ColorSwatchButton` out of the Inspector head and into ⋯ → Colour, keeping the
  component. Its layer stack still owns Escape order for the ⋯ menu and the
  popover.
- **#260 and #262 (Town peek, chat window in `WindowFrame`).** Superseded by
  the single-window rule. Town's desk tap and the docked FirstMate open the
  agent's Inspector window with Chat selected; there is no separate `town-chat`
  window. Hover peeks stay as small cards.
- **FM-CHAT-LAYOUT.** Owns only the Chat view body, which is `AgentChat` from
  #256 reskinned through tokens. Design owns the bar and the selector. Chat
  mounts while selected (Inspector view `history`), so drafts live in its store.
- **#258 (Chat send guard).** Content only, so no chrome impact.
- **Town HUD tokens.** FM-CHAT-LAYOUT shares `townHud.css` tokens
  (`--hud-panel`, `--hud-edge`, `--hud-font-*`, `.hud-panel`). It exposes
  `data-town-panel` and `--town-panel-width` on `.town-view-shell`, and the
  camera cluster keys off those.
- **Roamgate seam.** `WindowBar` lives in `web/src/world/windows/`, which World
  owns. The Roamgate-derived `WorkspaceInspectorHost` stops rendering its own
  head and supplies slot content instead: identity, views and actions. That is a
  small, upstreamable "header slots" change; its view logic stays where it is.

## One layout for every agent state

Testing #262 showed one window drawing a different layout per state. "On a
break" had a card, a reply box and a row of Inspector, Colour and Next buttons.
"Finished" had a card, Mark reviewed and Follow up, then the terminal key bar
and the global phone composer below it. The target is the same layout in every
state (working, needs you, on a break, finished, unknown and shell):

| Place | Holds | Never holds |
| --- | --- | --- |
| Header (one bar) | Avatar (its ring is the colour), name, status and location line, the selector `[Chat \| Terminal \| Changes \| Files]`, Next ›, ⋯, close or Back | A second row of actions |
| ⋯ menu | Colour, Mark reviewed (when finished), minimise, snap and float or Position, open in Spaces | Navigation between views (except the "More views" overflow under 360px) |
| Chat body (`AgentChat`) | The conversation; a waiting agent's question with its answers as chips at the end of the conversation, numbered 1–3 for the keyboard | Cards duplicating the latest message |
| State chips (Chat only, above the composer) | At most one slim row, 32px high, that scrolls sideways and appears only when the state has actions. Finished: `✓ Mark reviewed` and `↩ Follow up` (Follow up focuses the composer). Needs you without listed answers: `Open terminal`. | Full-width buttons, Inspector, Colour, Next |
| Composer (Chat only) | Attach, reply box, send. There is exactly one. | The global phone composer, the terminal key bar |
| Terminal view | The terminal, plus on a phone Roamgate's key bar and terminal input | The chat composer and state chips |

The Inspector button disappears because this window is the Inspector. While
Chat is shown, the phone's global composer and the terminal key bar are hidden;
they belong to the Terminal view. Hover peeks on desktop are cards, not this
window, and may keep their one-line reply.

## Phone window placement

The agent's one window on a phone (today a full-screen "compact" frame) can be
moved and resized by touch. This replaces the sheet behaviour that #262 gave the
retired chat window.

- **Placements:** `full` (the default, below the safe-area top), `bottom` sheet,
  `top` sheet, and `floating` (a card the width of the screen less 24px).
- **Move:** drag the window bar (not its buttons). Releasing in the top 15% of
  the screen docks top, in the bottom 15% docks bottom, and anywhere else
  floats. Dragging a docked sheet against its own edge changes its height
  instead.
- **Height:** sheets snap to ⅓, ½ or full when released within 24px of a snap
  point; otherwise the height is kept as dragged (free resize). The minimum is
  the bar plus 96px of content. Dragging past the minimum snaps to ⅓; it never
  closes the window, because Back does that. A floating card resizes from its
  bottom edge.
- **Keyboard-safe:** while the on-screen keyboard is open (`visualViewport`, the
  existing `--keyboard-inset-content`), Chat's composer stays attached to the
  keyboard and the bar stays visible. A bottom sheet's height is capped at the
  visible viewport less the safe-area top. A top sheet or floating card whose
  composer would sit under the keyboard grows to full until the keyboard
  closes, then returns.
- **The map stays live:** outside a sheet or card, Town still pans, zooms and
  takes taps.
- **Persisted per device:** placement, height fraction and floating rectangle
  go in local storage only (`worldWindowPhoneLayout.v1`). The setting applies
  to every agent window, not to each agent separately.
- **Non-gesture path:** ⋯ → Position offers Full screen, Top, Bottom, ⅓, ½ and
  Floating. Reduced motion turns off the settle animation.
- **Ownership:** design owns the bar (the drag target) and ⋯ → Position. Peek
  implements the gesture and placement state in `WindowFrame`'s compact mode,
  reusing `MobileSheetHandle`'s drag and settle logic, so there is one code
  path.

## Phase 2 (after owner approval)

1. `WindowBar` with Town and calm skins, used by the Inspector, the Spaces tab
   window and the Town chat window. Removes bars 2 and 3 and the PR card band.
2. Town shell defaults: no top bar, tab strip or sidebar in Town; HUD bar;
   Workspaces drawer; the phone camera button.

## Owner decisions (2026-10-22)

- **Q10, Town is full-bleed by default.** That is Zen mode. Town defaults to
  Zen, and Zen works on phones too. In Zen, a small floating view picker
  switches between Town, Board, Desk and Spaces. On desktop it hangs from the
  top edge with Exit Zen beside it. On a phone it is a 52px button in the
  bottom-left corner on root screens, and it opens a short menu (the four views
  and "Show the bars"). It replaces the bottom nav while Zen is on.
- **Q11, yes.** Board drops the tab strip; Spaces merges it into the title bar.
- **Q12, yes.** Pixelify Sans and JetBrains Mono are bundled locally (OFL). No
  Google Fonts requests.
- **Q13, tabs.** FirstMate and the agent you opened share the dock as tabs. To
  keep one bar, the tabs are avatar buttons at the start of the bar, like pinned
  browser tabs. The active tab shows its name and location line; the others show
  only an avatar, with a dot when they need you. There is no extra tab row.
- **Q14 and the single-window rule (after testing #262).** There is one window
  per agent: the Inspector window, themed per view. There is no separate peek or
  chat window, and Town's desk tap and the docked FirstMate open this window.
  - The header holds identity (colour, name, status and the location line), ONE
    top selector `[Chat | Terminal | Changes | Files]`, then the window
    controls.
  - The body is the selected view. Chat is the existing `AgentChat` (#256),
    reskinned for Town through tokens rather than built as a new component.
  - The bottom holds Chat's composer (attach, reply box, send), only in Chat.
    No button rows, no bottom tab strip and no thumb row.
  - **Phone header** at 390px: `‹ · avatar · name/status · [💬 ▣ ± 📁] · ⋯`.
    The selector is four 40px icon targets in the top bar. Next moves into ⋯,
    because the need-you pill already covers it.
  - **Desktop header:** `‹ · tab avatars · name/location · [💬 ▣ ±2 📁] · Next › · ⋯`.
    Chip labels appear at 640px of window width or more.

- **Header breakpoints (the window's own width, via container queries).** The
  same rule applies docked, floating and on phones:

| Window width | Selector and actions |
| --- | --- |
| 640px and up | Icon and label for Chat, Terminal, Changes and Files; labelled actions ("Next (1) ›") |
| 360–639px | Icons only, each with a tooltip and an aria-label; Next shows "(1) ›" |
| Under 360px | Active view chip only; the other views are at the top of ⋯ |

  This supersedes the earlier composer-row options (A, B and C).

## Questions answered

1. Should Town hide the app top bar, tab strip and sidebar by default (the HUD
   plus a ☰ drawer), or should the sidebar only start collapsed?
2. Should Board drop the tab strip and Spaces merge it into the title bar?
3. Pixelify Sans and JetBrains Mono aren't bundled today. Can we bundle them
   locally (OFL; adds font files and notices) instead of using fallbacks? A
   local-first app shouldn't fetch Google Fonts.
4. On a laptop, should the FirstMate chat fold to its bar above the agent window
   (as shown), or share the dock as tabs?
5. On phone, should the view chips sit in a thumb row above the composer (as
   shown), or stay in the top bar?
