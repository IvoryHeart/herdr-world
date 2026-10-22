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
| 2 | Terminal · Files · Changes · Commits · Chat | constant | View chips in the one bar; a thumb row on phone |
| 3 | Branch-link row | rare | Removed; the location popover covers it |
| 3 | PR card on Changes and Commits | sometimes | Pill in the Changes toolbar, plus the popover |

## The design

**One bar, one frame, two skins.** A World-owned `WindowBar` renders inside
`WindowFrame`, with slots for lead, identity, views, primary action and overflow.
Every window kind fills those slots instead of drawing its own head: the
Inspector, the Spaces tab window and the Town chat window.

- **Town skin** (Town v4 prototype): dark translucent panel with a 2px edge and
  soft shadow, 40–44px targets, and the name in Pixelify Sans. The bar is
  `‹ Back · avatar · name / location line · view chips · Next › · ⋯`, 58px in
  total. View chips are icon-only except the active one until the window reaches
  640px, then all are labelled. Pane chips get a second row only when the desk
  has two or more panes. Chat owns the conversation, answers and composer
  (FM-CHAT-LAYOUT).
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
| Phone | The window covers the screen; Back returns to the map | Back, name and Next on top; view chips in a 44px thumb row above the composer | Bottom strip; one 44px camera button; bottom nav kept |
| Mac laptop | Right dock, `min(520px, 40vw)`. FirstMate chat folds to its bar above the agent window | Icon chips except the active one | Left rail; camera beside the dock |
| Half-width Linux | Right dock, 508px; both windows open in halves | As laptop | Left rail; hosts shown as an icon |
| Wide Linux | Two docked 520px columns: FirstMate chat and the agent window | Labelled chips | Left rail |
| Portrait | Bottom dock at 45% height, windows side by side | Town skin | Left rail; camera above the dock |

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

- **#261 (layers, colour swatch).** Merge as is. Phase 2 moves its
  `ColorSwatchButton` out of the Inspector head and into ⋯ → Colour, keeping the
  component. Its layer stack still owns Escape order for the ⋯ menu and the
  popover.
- **#260 and #262 (Town peek, chat window in `WindowFrame`).** The `town-chat`
  scope keeps Chat's own header (‹, name, where, Next ›). Phase 2 turns that
  header into the Town-skin `WindowBar` by adding the view chips and ⋯. #262's
  `WindowControls` then move into ⋯ for the Town skin. No separate window bar is
  added.
- **#258 (Chat send guard).** Content only, so no chrome impact.
- **FM-CHAT-LAYOUT (`agent/chat-layout`).** It shares `townHud.css` tokens
  (`--hud-panel`, `--hud-edge`, `--hud-font-*`, `.hud-panel`). It exposes
  `data-town-panel` and `--town-panel-width` on `.town-view-shell`, and the
  camera cluster keys off those.
- **Roamgate seam.** `WindowBar` lives in `web/src/world/windows/`, which World
  owns. The Roamgate-derived `WorkspaceInspectorHost` stops rendering its own
  head and supplies slot content instead: identity, views and actions. That is a
  small, upstreamable "header slots" change; its view logic stays where it is.

## Phase 2 (after owner approval)

1. `WindowBar` with Town and calm skins, used by the Inspector, the Spaces tab
   window and the Town chat window. Removes bars 2 and 3 and the PR card band.
2. Town shell defaults: no top bar, tab strip or sidebar in Town; HUD bar;
   Workspaces drawer; the phone camera button.

## Questions for the owner

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
