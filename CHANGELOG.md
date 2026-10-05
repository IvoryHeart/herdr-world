# Changelog

This changelog records Herdr World releases and downstream changes. Current releases identify the
exact Roamgate source synchronization in [UPSTREAM.md](UPSTREAM.md); historical release entries
retain their original Herdr Web lineage. Unreleased entries describe user-facing changes; PR links
are optional because the merged PR history records their source.

## [Unreleased]

### Changed

- Inspectors and arranged Spaces windows now share stable snapping, all-edge resizing,
  minimize/window switching, maximize/restore and tile dividers. Opening or focusing
  another window preserves existing placements. Tree uses the same window surface,
  and the Office Docked preference becomes Snap right. Closing a Spaces window
  dismisses its presentation while leaving the Herdr tab running. Desktop window
  switching and arrangement controls are always reachable from the top bar.
  Resizing a scrolled tile preserves its canvas position, and Open all restores
  dismissed or minimized windows even when Grid cannot fit the work area.
  Snap and maximize previews match the visible work area in scrolled layouts,
  while dragging and resizing retain the full canvas bounds.
- Mobile keeps the ellipsis menu floating, uses the second-row Tabs menu for tab
  actions and window restoration with Arrange beside it, removes the duplicate list
  icon and tab strip, and measures World shell height once for terminal and keyboard sizing. Desktop
  placements survive compact views. Roamgate terminal and pane ownership remain intact.
  Selecting a tab opens its terminal Inspector in every visual view, including
  before any Inspector is selected and when its panes need loading.

- Default update checks read the release version from GitHub API metadata. The
  manifest remains part of the verified update installation.

## [0.2.1] - 2026-10-04

### Breaking Changes

- Hosts now filters an aggregate Desk, Office, Tree and Graph view instead of selecting
  one operational host. Manage connections remains separate. Open Inspectors,
  terminals and resources retain their qualified host across filter and focus
  changes; global creation confirms a single destination.

### Added

- Added the Desk, now the default view, with triage across filtered hosts and
  connection-qualified receipt and screen reads. It sorts agents into Needs you, To review,
  and In flight. Each card shows the agent's question, report, or live terminal
  line, and the turn's request, duration, and edited files. The cards support
  keyboard triage. Agents and Reviewed modes, one search across them, and Undo
  after marking keep every agent and reviewed stop one step away. On wide
  screens, agents open in a docked reading pane beside a one-column queue.

- Concurrent local/SSH terminal and Inspector contexts over one World origin,
  host-local retirement, qualified notification reveal, fair bounded multi-host
  projection and observation, full-observation paged search, honest coverage and
  cross-host window arrangements with independent restore baselines.

- Added "Promoted to CEO", a 62-second animated film about Herdr World, to the website.
  It plays in the browser with a synthesized soundtrack and no video download.

- Added `agent:await` for foreground agent commands with bounded output, private
  logs and preserved exit codes, plus repo-local Herdr Workflows operating guidance.

### Changed

- Office reuses unchanged rooms and cached static artwork, prepares graphics in
  bounded tasks, and retains semantic controls and keyboard focus across topology
  refreshes. State paints continue during uninterrupted terminal typing.
  PixiJS 8.22 keeps animation, selection and scrolling responsive while preserving
  the established scene. Decorative motion yields briefly to terminal typing;
  hidden, idle and reduced-motion scenes stop autonomous paints. Shared furniture
  geometry and stable selection projections further reduce refresh work. Graph
  physics runs in a worker with spatial queries, cached drawing and a shared
  visibility/input-aware frame scheduler. Office and Graph input regression budgets are
  tightened to p95 below 150 ms and worst case below 450 ms.

- Worktree resource requests expire after twenty-five seconds and are cancelled when their
  owner is discarded. Retrying Files or Changes preserves the already-open checkout
  without repeating its opened hook. Qualified workspace reads discard remembered
  targets that have closed, so the checkout can reopen on the next attempt. Workspace
  list failures report the failed read without implying a checkout reopen was attempted.
- Upgrading to the aggregate multi-host Desk resets existing browser-local Desk
  review marks once because their storage scope and receipt identities change.

- Worktree Files and Changes open the owning visual Inspector without switching
  unrelated Spaces focus. Temporary-workspace removal retains cleanup failures.

- Status-only agent updates retain confirmed session identity for notification
  targets; reported session replacements wait for confirmation. Removed host
  priority hints no longer block healthy snapshots, and overlapping clients
  preserve queued host priority.
- Qualified workspace commands retain visible failure feedback and Git pull
  progress/output. Git mutation uncertainty remains visible with its original
  host after retirement, without replay or replacement-context refresh.

- Desk receipt and screen queues run independently by host and share bounded
  read capacity across equally urgent hosts, so slow hosts leave healthy agents
  available for review and live observation.

- Inspector tab shortcuts restore the destination tab's selected pane and refresh
  unobserved panes. File preview and Changes cache invalidation follows runtime
  generations even when browser transport epochs differ. Mutations whose response
  is withheld after runtime retirement retain an uncertain-outcome notice naming
  the owning host even if the browser has already observed retirement; retirement
  after successful response decoding remains a stale-context error.

- Mobile top-bar controls use icons for Hosts, view selection, Actions and Menu,
  with a distinct compass for view selection, a host-count badge that counts
  matching runtime endpoints once, and
  aggregate status text hidden.

- Spaces sidebar selections activate the terminal's owning host. Workspaces with
  shell terminals can expand in the host navigator even when no agent is running.
- Host groups and terminal rows keep their established order when selection,
  focus or agent status changes.
- Office keeps admitted workspace rooms, desks, pane devices and standing agents
  in a stable order when terminals are selected. Graph retains readable node
  labels when Fit zooms out.
- Hosts adds collapsible groups around the existing workspace navigator, retaining
  its agent layouts, worktrees and context menus. The host filter opens above the
  toolbar with connection management. Workspace/room selections open Files;
  agent, pane and tab selections open terminals on their owning host even before
  its first operational refresh finishes.
- Terminal input with a lost acknowledgement reports its original host and an
  uncertain outcome, with refresh-before-retry guidance and no replay.
- Large aggregate updates share the World socket in bounded reply chunks, and
  dense scene controls render progressively to keep host input responsive.
- Saved Hosts filters survive the initial connection handshake until a valid
  catalogue arrives. Large snapshots decode off the browser's main thread;
  unchanged terminal surfaces and offscreen scenes avoid redundant drawing.
- Dense aggregate indexing yields between bounded batches and preserves complete
  coverage totals. Office limits reception painting to the visible horizontal
  region while retaining every host in its semantic overview. Streaming output
  preserves another terminal's keyboard focus.
- Dense host construction also yields and cancels within a host. Office reuses
  qualified pane devices across its scene and complete roster, and newer
  Inspector control focus supersedes queued terminal refocusing.
  Expired aggregate observations yield between hosts to admit terminal input.
  Snapshot decoding admits one host payload at a time so socket acknowledgements
  can interleave with observation work.
  Negotiated snapshot transport waits for browser admission after each bounded
  chunk batch, preventing bulk replies from queuing ahead of terminal input.
  Progressive Tree admission reuses unchanged spaces instead of rendering
  every admitted subtree again on each batch.
- Graph overview keeps every node and semantic target while deferring unreadably
  small canvas text until zoomed in.
- Office constructs and paints its visible scene across cancellable task turns,
  admitting matching layout controls through ordinary tasks after painting.
  Its canvas and text textures follow the visible viewport and device resolution
  while retaining the complete layout and two-axis navigation.
- Removed the homepage film introduction so the video leads directly from the
  navigation into the product content.
- Removed CEO Mode from the homepage navigation and added a full-screen film
  control. The film now shows the full website URL and a one-shot npm command.
- Styled the homepage, film, and social preview cards as Herdr.World.
- Put the "Promoted to CEO" film first on the homepage, with a Home navigation
  link. Its play overlay and controls now clear during playback.
- Turned the product hero screenshot into a carousel of the six showcase views.
- Moved installation closer to the top of the homepage and showed Homebrew,
  npm, and standalone commands together.
- Refreshed the website and README screenshots with the 0.2.0 interface, including
  readable Files, Changes, and agent History examples.

### Fixed

- Kept Inspector terminals in sync with keyboard tab navigation and creation,
  and revealed qualified notification targets omitted from the host overview.
- Preserved refresh support on the declared browser baseline. Interrupted file
  mutation responses now report uncertain outcomes and refresh the owning
  directory; healthy iOS downloads retain their fallback when native sharing fails.

- Preserved server error details for rejected resource requests and showed failed
  file and session downloads without reopening them on another path.
- Kept worktree results focused through metadata refreshes while respecting newer
  browser selections, and prevented duplicate workspace creation submissions.
- Reported observed watch counts when another filtered host is unavailable.
- Prevented Office animation from starving large aggregate refreshes while
  another host remains interactive. Removed redundant transport and decoder
  timer turns while preserving bounded batches and one-host admission.
- Kept the film's 16:9 picture from stretching in portrait fullscreen playback.

## [0.2.0] - 2026-10-02

### Highlights since 0.1.1

- Explore agent work in Office, Tree, Graph, and Spaces, with terminal, files,
  changes, and history available from the selected agent in every view.
- Keep multiple Inspectors open and arrange, move, resize, or dock them while
  preserving each live conversation. Graph can arrange or rotate its layout.
- Connect to local and OpenSSH Herdr hosts through one World service. Select the
  host you want to work on while other connected hosts remain visible in the
  background.
- Follow agent progress with task summaries, checkout context, pane pins,
  notifications, and optional Office metrics. Visual Actions take you to the
  selected agent's details or workspace.
- Install the same release through six desktop archives, the standalone
  installer, npm, Homebrew, or the Herdr plugin. The responsive PWA provides a
  mobile view when World is reachable.

### Breaking Changes

- Replaced the 0.1.1 app with a new World service and responsive Web/PWA.
  Recreate connection profiles after upgrading; old bridge profiles and browser
  preferences are not imported. The native Android package is retired.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Task summaries now follow the current pane session and expire automatically.
  Hooks using `herdr-world task-summary --clear` must be updated; the command
  no longer accepts `--clear`.
  [Herdr World PR #105](https://github.com/IvoryHeart/herdr-world/pull/105)

### Added

- Prepared the project website and tutorial for `herdr.world`, including search,
  social preview and Homebrew homepage metadata.

- Added Tutorial, Features and shortcuts, Troubleshooting, and Report an issue
  links to the application menu. Restored native HTTPS, Web Push, compatibility,
  logging, and Pane Search guidance; corrected inherited documentation links
  and website attribution. Stable release publication now requests a Pages
  deployment while retaining the live installer guard.

- Restored the npm and Homebrew installation channels for the new foundation.
  npm now installs one platform binary through optional dependencies; Homebrew
  installs the same checksum-pinned release archive. Both serve the one World
  service and require Herdr as a separate runtime. Release candidates use all six
  platform archives, npm's `next` tag and a separate Homebrew RC Formula.
- Added a clickable pane-count laptop on each Office desk and up to three surrounding monitors so
  split-pane agents keep exact terminal targets after leaving their work room. Done agents now join
  input-needed agents at their host's reception with distinct `✔` and `?` cues; extra agents stand
  nearby before entering the roster. Up to four additional working agents can gather around the
  same desk without covering each other's faces or its pane screens. The compact Office chooser
  pages longer rosters so every admitted pane remains reachable.
- Added accessible maximize and resize controls across Office Inspector windows,
  focus-based window stacking, and Close all terminal windows in Arrange and
  Actions. Close all preserves Herdr tabs and sessions; Spaces keeps each
  workspace suspended until explicit tab selection or arrangement. Graph can
  rotate left or right in quarter turns while keeping labels upright. Floating
  Inspectors no longer stop at five. Grid and Rows scroll vertically, while
  Columns scroll horizontally, keeping large window sets usable with nearby
  terminal views mounted. Cascade repeats its overlapping pattern in scrollable
  stages when another offset would make windows too small. Open all terminal
  windows in Arrange and Actions presents every available terminal tab on the
  selected host. Arranged Inspectors have prominent scroll controls at fixed
  stage edges, and switching layouts keeps windows visible; scrolled windows
  stay clipped inside the stage.
  [Herdr World PR #123](https://github.com/IvoryHeart/herdr-world/pull/123)
- Added an Arrange graph control beside Fit in Graph view. Arrange spreads visible
  nodes into a readable hierarchy, wraps multiple hosts, and recenters the camera
  after manual pan while preserving zoom when possible. Arranged positions stay
  fixed through graph revisits and topology updates, and nodes remain draggable.
  Fit remains a separate viewport action; both controls are visible whenever the
  Graph canvas is shown at narrower desktop widths.
  [Herdr World PR #116](https://github.com/IvoryHeart/herdr-world/pull/116)
- Added shared tab-bar arrangements for existing Spaces tabs and open visual
  Inspectors: Single, Cascade, Columns, Rows, Grid, and Restore positions. Split
  panes remain inside one tab window, docked and Tree inline Inspectors can join
  an arrangement, Cascade uses the default floating-window size, and Columns and
  Rows shrink evenly for additional windows while keeping controls usable. Layouts
  that cannot fit explain their size limits. The desktop layout button sits at
  the tab bar's right edge and mobile places it in the ellipsis-expanded controls.
  The same placements are available through the original shell Actions command
  menu in every view; keyboard shortcuts can be assigned in preferences and
  are unassigned by default. Compact visual views keep desktop placements
  across arrangement and resize input for return to desktop, and tiled Inspector
  headers keep their controls reachable.
  [Herdr World PR #111](https://github.com/IvoryHeart/herdr-world/pull/111)
- Added connection- and generation-qualified Actions to Office, Tree and Graph.
  Actions capture the visible selected entity, reopen its existing Inspector
  resources or focus it before entering Spaces, and reject retired selections
  without using hidden Spaces focus. They provide no terminal injection, task
  assignment or agent lifecycle controls.
  [Herdr World PR #108](https://github.com/IvoryHeart/herdr-world/pull/108)
- Added `herdr-world agent-checkout` and a read-only Agent checkout Inspector
  scope. Harnesses report a bounded, session-fingerprinted checkout once; World
  reads its branch and changed files on the same qualified connection, offers an
  explicit Workspace changes scope, and labels unverified links as Reported PR.
  Reports have no TTL, renewal hook, Clear command, or agent-path Git mutations.
  [Herdr World PR #107](https://github.com/IvoryHeart/herdr-world/pull/107)
- Added a bounded service-memory watchlist for exact qualified agent and terminal
  panes. Office, Tree and Graph share Pin/Unpin updates across browser windows;
  watched topology is reserved within World observation bounds and unavailable
  records never enable operational actions.
  [Herdr World PR #106](https://github.com/IvoryHeart/herdr-world/pull/106)
- Added short, expiring task summaries for the active agent session. A harness
  can publish a summary without starting the World service, and World hides it
  when the session changes.
  [Herdr World PR #105](https://github.com/IvoryHeart/herdr-world/pull/105)
- Added Herdr semantic task notifications, plugin popup panes, terminal font
  sizing independent of interface scale, and File Explorer path drag into terminals
  from the Roamgate source merge.
  [Herdr World PR #103](https://github.com/IvoryHeart/herdr-world/pull/103)
- Added in-app setup for local and OpenSSH Herdr connections, with clear retry
  and failure states in one World application.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added a view of several connected Herdr hosts while keeping actions scoped to
  the selected host and unavailable hosts read-only.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added Office, Tree, Graph, and Spaces with shared navigation to terminals,
  Files, Changes, and Agent History.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added optional Office Economy metrics with in-app configuration and a clear
  provider status; core views and terminals work without them.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added standalone archives, an installer, service management, and a Herdr
  plugin for Linux, macOS, and Windows.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Changed

- Improved file links in Windows terminals and recognition of wrapped links with
  Herdr 0.9.1 through the Roamgate v0.7.11 update.
- Kept the selected host responsive when another host is slow or unavailable.
  Delayed results can refresh its view later, while stale information cannot
  enable actions.
  [PR #104](https://github.com/IvoryHeart/herdr-world/pull/104)
- Updated file diffs, worktree navigation, and notification behavior from
  Roamgate v0.7.10 while retaining World's separate Herdr connections.
  [Herdr World PR #103](https://github.com/IvoryHeart/herdr-world/pull/103)
- Updated sign-in, session handling, terminal transport, notifications, file
  previews, and diff navigation from Roamgate v0.7.9.
  [Herdr World PR #97](https://github.com/IvoryHeart/herdr-world/pull/97)
- Rebuilt the application on the Roamgate foundation while keeping Herdr as the
  separately installed runtime.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Restored the retained Pixi Office as the primary World surface and placed the
  machine selector, Office/Spaces/Tree/Graph selector, selected-host/runtime
  summary, Actions and Menu in that order in the existing application top bar,
  removed the separate Visual Control Plane header, and retained the Spaces
  workspace navigator, focused tabs and annotations as the common frame around
  every view instead of duplicating Graph navigation. The shared workspace
  navigator can now be hidden and restored from its stage-edge controls; Zen
  mode removes it from the stage layout and reveals it as an overlay from a thin
  left-edge target, parallel to the top bar.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Unified selected-agent identity with the shared Inspector in Office, Tree,
  Graph and Spaces; placed Terminal first and made it the default for each new
  terminal-capable selection, with one docked and up to five independently
  movable/resizable full Inspectors that retain their own tabs and resources.
  Office now defaults new installations to separate cascaded floating Inspectors,
  persists a user's docked or floating choice in the common Menu, and keeps room
  alignment, long-title and observability settings there instead of reserving
  Office or Zen scene space. Tree now expands the exact selected leaf as its inline
  Inspector and transfers the complete conversation through Dock out and Dock in.
  Explicit docking actions remain available without rearranging existing
  conversations.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Made the release version consistent in the application, archives, plugin,
  and update information so an installed build is easy to identify.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Kept qualified multi-host observation in the service and browser store while
  making Office, Tree, Graph, their counts, and search show only the browser's
  selected operational host. Search now occupies one shared top-bar control slot,
  with Graph Fit and zoom beside it instead of a duplicate stage header.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Fixed

- Release candidates now check for newer candidates in their own version line,
  while package-managed installations avoid in-app binary replacement.

- macOS service installation now reports an occupied port instead of claiming
  success while the new World service repeatedly fails to start.

- Plugin actions and panel now launch from the Herdr server without requiring Bun
  on its `PATH`; Bun is needed only to install or build the plugin.

- An occupied World listener now explains how to keep the existing process and
  choose a persistent alternate port during an upgrade.

- Kept a partly clipped Inspector stationary when pointer focus raises it during
  Columns arrangement, while keyboard focus still scrolls it into view.
- Opened terminal file links in the originating Office, Tree or Graph Inspector's Files tab,
  focused the exact selected pane when activating a visual terminal window, and opened a newly
  created Office desk's terminal as soon as its pane was admitted.
- Kept a dragged or resized Inspector from moving focus to its Terminal input
  and scrolling a partly clipped arranged window into view.
- Kept browser-local Office creation ready without first visiting Spaces or
  opening an Inspector, unified seat, room and tab-strip availability feedback,
  and preserved the prior Inspector while bounded exact focus reports failures.
  [Herdr World PR #114](https://github.com/IvoryHeart/herdr-world/pull/114)
- Kept open floating Inspectors visible through failed, stale or bounded World
  observations and through focused tab lists fetched before a new Inspector opens.
  [Herdr World PR #111](https://github.com/IvoryHeart/herdr-world/pull/111)
- Reconciled Android terminal textarea replacements as tail edits so mobile
  autocorrection, deletion and revised text no longer resend accumulated input
  or lose corrections.
  [Herdr World PR #96](https://github.com/IvoryHeart/herdr-world/pull/96)
- Kept Inspector windows responsive while docking, swapping, or changing agents,
  and removed duplicate controls that obscured the selected agent.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Made host navigation and tab selection reopen the matching Inspector without
  switching to the wrong conversation or unexpectedly moving a docked window.
  Office room and seat controls now become available when the scene is ready.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Preserved live terminal and resource tabs while moving between Office, Tree,
  Graph, and Spaces. Floating Inspectors remain movable and resizable on desktop
  and touch devices; compact views keep their resource controls visible.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Kept important agents visible in dense hosts and reported when view limits
  hide other agents. Slow observations no longer block the selected host's view.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Closed an Inspector when its terminal was retired and kept Office room and
  seat controls visible during temporary connection delays.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Restricted privileged browser traffic to the World service, kept disconnected
  hosts read-only, and displayed the release version in the application.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Removed

- Removed browser-to-bridge federation, remote World installations and the former
  Host, Origin and cross-origin CSP configuration workflow.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Removed the Rust bridge, vendored Herdr compatibility crate, native Capacitor
  Android build and inherited legacy service/preference migration paths.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

## [0.1.1] - 2026-09-01

> **Herdr Web baseline:** Derived from v0.5.0 plus the JetBrains Mono Nerd Font fallback merged in upstream PR #74 at
> [`4384c884`](https://github.com/kcosr/herdr-web/commit/4384c884da418ea3f3fb75954da5347b2e12f063).

### Added

- Added an accessible live Graph theme with bounded project/space and attached-terminal topology,
  detected agent or empty-shell identity, stable force layout, search, collapse, pan/zoom/fit
  controls, semantic navigation, connected live terminal overlays, and explicit Open-in-Spaces
  handoff.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

### Changed

- Made Office the default `/` experience, moved Spaces to `/spaces`, retained `/world` as a
  compatibility alias, replaced the Office tab with an Office/Graph World theme selector, made a
  settled fitted camera the Graph default while retaining explicit manual camera adjustments, and
  unified the initial Graph and Office terminal window footprint. Expanded the README and project
  site with privacy-safe Graph showcase captures and an accessible, reduced-motion-aware product
  carousel.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

### Fixed

- Kept World terminal windows resizable and attached to the same live session across Office/Graph
  theme changes, retained a perceptible Graph node connector in desktop and compact layouts,
  including while its space is collapsed, prioritized detected agents at Graph presentation
  bounds, exposed complete terminal state and touch-sized bounded zoom controls accessibly,
  distinguished connecting and degraded retained snapshots from offline hosts, kept movable spaces
  clear of pinned nodes, composed compact theme navigation into one traversable history entry,
  bounded Graph projection preprocessing, skipped inactive Graph work so rapid runtime refreshes
  do not stall Office, and bounded terminal canvas refits and preference writes during rapid window
  resizing so neither World theme can saturate the browser tab.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

## [0.1.0] - 2026-08-31

> **Herdr Web baseline:** Derived from v0.5.0 plus the JetBrains Mono Nerd Font fallback merged in upstream PR #74 at
> [`4384c884`](https://github.com/kcosr/herdr-web/commit/4384c884da418ea3f3fb75954da5347b2e12f063).

### Added

- Added `herdr-world task-summary` for agent harnesses to publish or clear bounded, expiring,
  session-qualified Office summaries through Herdr's existing pane-metadata contract.
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)
- Added 48 CSS-pixel semantic Office targets and a compact Agents, Rooms, and Desks chooser so
  mobile users can select exact scene identities without relying on small pixel-art hit areas.
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)
- Added a bundled JetBrainsMono Nerd Font Mono fallback for special terminal and LLM output glyphs
  on devices without an accessible Nerd Font.
  [PR #74](https://github.com/kcosr/herdr-web/pull/74), contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin).
  [Herdr World PR #60](https://github.com/IvoryHeart/herdr-world/pull/60)

### Changed

- Made release preparation a reviewed pull-request change, correlated each World release with its
  exact Herdr Web baseline instead of duplicating the upstream changelog, and restricted the
  post-merge release command to verifying exact `main` and creating the immutable release tag.
  [Herdr World PR #63](https://github.com/IvoryHeart/herdr-world/pull/63)
- Replaced the reference-heavy README with a concise user guide covering installation, essential
  advanced usage, contribution and support paths, licensing, acknowledgements, and Pixel Office
  previews for desktop and mobile.
  [Herdr World PR #59](https://github.com/IvoryHeart/herdr-world/pull/59)

### Fixed

- Kept stable README and project-site installation instructions on the npm `latest` and Homebrew
  stable channels, removed release-candidate-only download labels, and made Pages validation aware
  of the selected release channel. Release preparation also keeps the changelog preamble outside
  the fresh empty `Unreleased` section so tag validation sees the intended release boundary.
  [Herdr World PR #64](https://github.com/IvoryHeart/herdr-world/pull/64)
- Stopped Office anchor updates from recursively rebuilding the Pixi scene while idle or resizing,
  keeping the interface responsive without increasing terminal resize traffic.
  [Herdr World PR #62](https://github.com/IvoryHeart/herdr-world/pull/62)
- Released scene-owned Pixi graphics contexts and text styles after each Office redraw so
  long-running sessions do not retain every discarded scene until the tab crashes.
  [Herdr World PR #62](https://github.com/IvoryHeart/herdr-world/pull/62)
- Preserved external Office focus across terminal connection retries so a late
  terminal autofocus cannot consume Escape instead of closing the topmost
  conversation window.
  [Issue #5](https://github.com/IvoryHeart/herdr-world/issues/5),
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)

## [0.1.0-rc.15] - 2026-08-30

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Changed

- Made release publication fail closed behind the exact unpublished npm payload's full Herdr plugin
  lifecycle and the generated Homebrew Formula lifecycle on Linux x86-64, macOS ARM64, and macOS
  x86-64. The explicit distribution preflight now exercises those same gates before any tag is cut.
  [Herdr World PR #57](https://github.com/IvoryHeart/herdr-world/pull/57)

### Fixed

- Kept release-smoke Herdr sockets below the macOS Unix-domain socket path limit instead of nesting
  them under the runner's long temporary directory.
  [Herdr World PR #57](https://github.com/IvoryHeart/herdr-world/pull/57)

## [0.1.0-rc.14] - 2026-08-30

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed macOS launchd startup to rely on the plist's `RunAtLoad` behavior, include the failing
  supervisor command in diagnostics, and safely unload a partially bootstrapped service after
  startup failure while retaining recovery state when cleanup cannot be verified.

## [0.1.0-rc.13] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Synchronized the Herdr plugin release smoke with asynchronous startup-hook completion on macOS.
  [Herdr World PR #55](https://github.com/IvoryHeart/herdr-world/pull/55)

## [0.1.0-rc.12] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed the Herdr plugin doctor check to compare the active Node.js executable with the service record.
  [Herdr World PR #53](https://github.com/IvoryHeart/herdr-world/pull/53)

## [0.1.0-rc.11] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Made the Herdr plugin release smoke deterministic across asynchronous startup-hook execution.

## [0.1.0-rc.10] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Accepted GitHub's squash-merge suffix on protected release commit subjects so the release
  provenance gate matches the repository's PR merge strategy.
  [Herdr World PR #47](https://github.com/IvoryHeart/herdr-world/pull/47)

## [0.1.0-rc.9] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added a Herdr-native startup hook that starts the plugin bridge on the next Herdr server restore,
  with documented install, crash-restart, and port-conflict behavior.
  [Herdr World PR #41](https://github.com/IvoryHeart/herdr-world/pull/41)

### Changed

- Updated the project site with tabbed npm, Homebrew, and Herdr plugin installation paths plus a
  concise CLI quick reference.
  [Herdr World PR #42](https://github.com/IvoryHeart/herdr-world/pull/42)
- Kept the primary install tabs to the two commands users need and moved archive and lifecycle
  commands into a collapsed advanced CLI section.
  [Herdr World PR #43](https://github.com/IvoryHeart/herdr-world/pull/43)
- Split the installation card into npm, Homebrew, Herdr plugin, and CLI archive tabs, with
  method-specific advanced instructions and preview/stable channel guidance.
  [Herdr World PR #44](https://github.com/IvoryHeart/herdr-world/pull/44)
- Renamed the user-facing archive tab to `CLI` while keeping archive details in the CLI panel.
  [Herdr World PR #45](https://github.com/IvoryHeart/herdr-world/pull/45)

## [0.1.0-rc.8] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed RC npm publication to pass the downloaded package tarball as an explicit filesystem path.
  [Herdr World PR #39](https://github.com/IvoryHeart/herdr-world/pull/39); release correction:
  [Herdr World PR #40](https://github.com/IvoryHeart/herdr-world/pull/40)

## [0.1.0-rc.6] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added the Herdr World plugin manifest and lifecycle controller. Herdr can install the exact
  release-matched npm payload privately, supervise one loopback bridge per session, and expose
  start/stop/restart/status/open/doctor actions without changing the standalone npm, Homebrew,
  desktop, or Android distributions.
  [Herdr World PR #36](https://github.com/IvoryHeart/herdr-world/pull/36)

### Fixed

- Allowed npm release publication to wait for publish-time malware scanning before verifying the
  immutable version, integrity, and channel pointer.
  [Herdr World PR #34](https://github.com/IvoryHeart/herdr-world/pull/34)

## [0.1.0-rc.5] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Let Homebrew derive the package version from immutable release URLs, avoiding a redundant
  explicit version rejected by current Formula audit while preserving release-state safeguards.
  [Herdr World PR #33](https://github.com/IvoryHeart/herdr-world/pull/33)

## [0.1.0-rc.4] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Allowed the first Homebrew release channel to complete Formula audit and lifecycle validation
  before its declared sibling channel exists in a new tap, with manual runs installing the exact
  native artifacts locally instead of expecting a synthetic GitHub Release URL to exist.
  [Herdr World PR #32](https://github.com/IvoryHeart/herdr-world/pull/32)

## [0.1.0-rc.3] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Updated Homebrew release validation for current name-based audit and trusted-tap requirements.
  [Herdr World PR #31](https://github.com/IvoryHeart/herdr-world/pull/31)

## [0.1.0-rc.2] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added one protected release workflow that assembles exact native artifacts for GitHub, npm, and
  Homebrew distribution, with platform-aware npm bridge selection and stable/RC Homebrew channels.
  [Herdr World PR #29](https://github.com/IvoryHeart/herdr-world/pull/29)
- Added a desktop `install` / `herdr-world-installer` entrypoint that installs the complete
  versioned World bundle for the current user, exposes the `herdr-world` command, and then hands off
  to the consent-based Herdr dependency setup.
  [Herdr World PR #22](https://github.com/IvoryHeart/herdr-world/pull/22)

### Fixed

- Bounded terminal resize traffic during rapid pane and Office conversation resizing, preventing
  resize/output feedback from stalling the page while retaining the latest terminal dimensions.
  [Herdr World PR #23](https://github.com/IvoryHeart/herdr-world/pull/23)
- Treat stale default Herdr sockets as stopped instead of asking to stop a nonexistent daemon, wait
  for an actually compatible server after startup, and print the World URL before the foreground
  bridge begins serving.
  [Herdr World PR #22](https://github.com/IvoryHeart/herdr-world/pull/22)

## [0.1.0-rc.1] - 2026-08-26

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added automated, native Linux x86-64 and unsigned macOS ARM64/x86-64 release builds with archive,
  checksum, architecture, legal-content, launcher, and two-daemon stock Herdr v0.8.2 validation.
  [Herdr World PR #16](https://github.com/IvoryHeart/herdr-world/pull/16)
- Added deterministic production npm/Cargo licence inventories, exact runtime
  closure checks, and release/WebView assembly of the resulting notices.
  [Herdr World PR #9](https://github.com/IvoryHeart/herdr-world/pull/9)
- Added focused contribution guidance and a private vulnerability-reporting
  policy for the public Herdr World repository.
  [Herdr World PR #8](https://github.com/IvoryHeart/herdr-world/pull/8)
- Added Spec 015 work unit 2's focused Herdr Web v0.4.2/v0.4.3 replay: a supervised loopback
  `npm run dev` workflow with child-process tests, and an opt-in bounded terminal screen-reader
  text mirror. The replay preserves downstream World and multi-bridge behavior; Web v0.4.2/v0.4.3
  development/IME/focus/accessibility details are covered by this work unit's focused commits.
- Added `npm run dev` with a supervised loopback bridge/Vite workflow, bounded
  bridge readiness checks, clean child-process shutdown, and `test:dev`
  coverage for startup and signal/error paths. [Upstream PR #57](https://github.com/kcosr/herdr-web/pull/57),
  based on [PR #51](https://github.com/kcosr/herdr-web/pull/51) by Hopkins
  ([@LosEcher](https://github.com/LosEcher)).
- Added Spec 015 work unit 1 compatibility for Herdr `v0.8.2` and exact terminal protocol `20`,
  including the refreshed bridge wire/API slice, frozen protocol fixtures, bounded admission
  diagnostics, safe direct-graphics exclusions, and terminal-bell handling. Web v0.4.2/v0.4.3
  replay followed as a separate focused change.
- Declared the existing Herdr SVG logo as the browser favicon, synchronized
  from the audited Herdr Web upstream head `9897522`. Contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin) in
  [PR #56](https://github.com/kcosr/herdr-web/pull/56).
- Added a bounded Office productivity slice: browser-local restoration of Office window geometry,
  ordering, and scroll position; responsive room sizing; persistent selected-agent callouts for
  optional harness task summaries; and direct-federation Enable all / Disable all bridge controls.
- Added animation-frame terminal refits during Office window resizing to remove the extra inner
  canvas catch-up delay.
- Added an isolated Office settings surface for an optional Prometheus URL,
  with bridge-owned live configuration, per-bridge browser persistence, and
  clear provider health feedback. The generic Herdr Web settings remain the
  only integration entry point so the Office slice can be removed for an
  upstream contribution.
- Added short-lived Office terminal restoration across browser refreshes by
  persisting only qualified pane descriptors and revalidating them against an
  admitted snapshot.
- Restored the graphical Agent Bar as a separate room beside the CEO Office,
  including the Party board, single counter, and compact full-size agent
  sprites, while retaining a semantic keyboard and screen-reader overlay.
  Office room create, rename, and close actions remain capability-gated against
  Herdr workspace lifecycle commands.
- Added a documented `npm run dev:local` workflow that checks the Herdr socket,
  reuses or starts the bridge, and launches the web client with the correct
  development proxy.
- Added exact double-click shortcuts for current Pixel Office rooms and agents across the canvas
  and semantic roster. Direct double-click works without prior selection and reuses the guarded
  Spaces handoff while retaining single-click inspection and accessible inspector controls.
- Added an integrated Herdr World primary view with a deterministic Pixel Office projection of
  shared federated snapshots, live host coverage and filters, a qualified roster and inspector,
  bounded overflow and stale-host handling, responsive and accessible fallbacks, and exact
  revalidated `Open in Spaces` handoff without reload or reconnection.
- Added the federated client base: explicit app-shell and internal-surface seams,
  persistent host profiles, host-qualified runtime and terminal identities, direct multi-bridge
  browser federation, isolated compatibility/failure states, strict non-loopback admission policy,
  and browser/security/independence acceptance gates.

### Changed

- Made the desktop launcher detect a missing default Herdr session and offer an explicit,
  consent-based path to install Herdr from its official installer and start it in a user-selected
  workspace. Non-interactive, custom-session, and custom-socket launches remain fail-safe.
  [Herdr World PR #14](https://github.com/IvoryHeart/herdr-world/pull/14)
- Added a direct, checksum-verified desktop release quick start, an explicit public-platform matrix,
  a minimalist Pixel Office-themed GitHub Pages site, and launch-ready social artwork for the
  Herdr World public preview.
  [Herdr World PR #11](https://github.com/IvoryHeart/herdr-world/pull/11)
- Made the single release command update public README/Pages version references before tagging, so
  desktop assets and the project site publish from the same release operation.
  [Herdr World PR #16](https://github.com/IvoryHeart/herdr-world/pull/16)
- Completed the Herdr World product identity across the visible shell, Android
  application ID (`dev.herdr.world`), and desktop `herdr-world-*` release
  artifacts. Release tarballs now carry the project license, explicit
  third-party notices, retained license texts, upstream record, and source/asset
  provenance. Internal Cargo target and browser-state names remain unchanged for
  upstream comparison and existing-user compatibility.
  [Herdr World PR #7](https://github.com/IvoryHeart/herdr-world/pull/7)
- Established `IvoryHeart/herdr-world` as the independent downstream monorepo,
  renamed the app/package identity to Herdr World, and replaced the overlapping
  Specs 004/010/011 with one practical independence and upstream-sync contract.
- Reconciled the working protocol-20 World baseline with Herdr Web v0.5.0,
  adopting its missing mobile cursor, wrapped-URL copy, negotiated gzip output,
  and Attention-sort recency behavior while retaining World-specific behavior.
  Git records the upstream merge; `UPSTREAM.md` keeps only the current sync point.
  [Herdr World PR #1](https://github.com/IvoryHeart/herdr-world/pull/1)
- Replayed desktop IME composition cancellation/fallback handling and dialog/menu focus restoration
  across Spaces, Office, bridge settings, launchers, notes, and terminal overlays.
- Static bridge entrypoints and public files explicitly revalidate while
  successful content-hashed Vite assets use immutable caching; missing and
  error responses are not marked cacheable. [Upstream PR #57](https://github.com/kcosr/herdr-web/pull/57),
  based on [PR #51](https://github.com/kcosr/herdr-web/pull/51) by Hopkins
  ([@LosEcher](https://github.com/LosEcher)).

- Removed the persistent Office notice/status strip to return its vertical
  space to the canvas; provider details remain available through Office
  settings and the existing CEO boards/sidebar.
- Positioned the graphical Agent Bar beside the CEO Office with a dedicated
  pixel-road separator. CEO furniture and agent sprites remain at their native
  scale; only inter-block spacing and bar spacing are compacted. Room lifecycle
  actions remain disabled when the selected host does not advertise the
  required Herdr commands.
- Made the Office canvas follow the available viewport width and changed room
  placement from a fixed two-column cluster to an elastic full-width grid.
  Moved room rename/close controls into room title bars, moved room creation to
  an in-scene `+`, and removed the global `New seat` control in favour of the
  room-local desk actions.
- Distributed CEO-room boards and reception furniture across the available CEO
  area, expanded the desktop Agent Bar to 560px when space permits, and kept
  furniture spacing stable for rooms in a partial final row.
- Matched the Agent Bar Party count to the rendered bar occupancy, packed the
  first agent row against the counter, added drinks to the counter, and kept a
  disabled `+ / ROOM FULL` affordance visible after the eighth desk.
- Changed room placement to sequential natural-width row packing: each row fits
  as many 2–8-seat room templates as it can, later rows are not constrained by
  a wide room above them, and all room gaps remain snug and consistent.
- Added a persisted Office layout preference for left, center, or right room-row
  alignment, with left alignment as the default; CEO Office and Agent Bar placement
  remain dedicated and unaffected.
- Added pixel-road separators between responsive room rows and columns, nudged
  reception tables inward at the CEO boundary, and gave each visible Agent Bar
  agent an aligned glass alongside a rear shelf of drinks.
- Refined the Agent Bar composition by raising the counter and visible agents,
  keeping their glasses on the counter, and moving the bottle row into the
  lower edge of the room.
- Documented Office settings verification and tracked the usable-but-not-yet
  smooth terminal refit during conversation-window resizing as SUG-028.
- Kept the delivered Herdr sidebar shared across Spaces and Office, moved live admitted-state
  coverage onto a CEO-room blackboard, opened the CEO/reception composition for future plugin
  boards, shifted room furniture down within the existing wall clearance, and refreshed the Agent
  Bar with a warm Claw-Empire-inspired bar setting using the existing character art. The board now
  uses a legible three-column/two-row metric grid with a compact single-dot state cue, and the
  Agent Bar now packs full-size agents around one counter.
- Remodeled Pixel Office around qualified Herdr topology: tabs are desks; `working` and `unknown`
  agents work or stand in their exact workspace; `blocked` agents wait at horizontal host reception
  conference tables; and `idle` and `done` agents move to the shared Agent Bar. The reception floor
  retains one uncrowned user/CEO, reserves unused width for future displays, and gives CEO,
  reception, occupied, and empty desks visible chairs.
- Established one persistent Herdr client frame and federated runtime above the `Spaces | World`
  view boundary. `/world` is addressable browser state inside that frame, while Spaces retains its
  delivered sidebar, terminal, split, Notes, and operational behavior.
- Mobile terminals now use a static visible cursor instead of a blinking cursor, reducing continuous
  canvas redraw work on resource-constrained devices. Desktop cursors continue to blink.
  [PR #60](https://github.com/kcosr/herdr-web/pull/60)
- Terminal output now negotiates gzip compression between matching web apps and bridges, while
  remaining compatible with older versions and keeping incompressible updates raw.
  [PR #59](https://github.com/kcosr/herdr-web/pull/59)
- Changed the Attention agent sort to break ties within an attention band by the most recent agent
  status change, matching Herdr's Priority agent panel, and kept the existing bridge, Space, and tab
  order as the fallback for agents with no recorded transition.

### Fixed

- Kept the official Herdr installer's stdout diagnostics out of the launcher's resolved executable
  path, allowing guided macOS installation to stop an incompatible daemon and continue startup.
  [Herdr World PR #21](https://github.com/IvoryHeart/herdr-world/pull/21)
- Added a guarded same-tag prerelease reissue mode for correcting an unannounced candidate without
  inventing another release-candidate number. It retains all normal remote, tag, release, and test
  safety checks and cannot replace a stable release.
  [Herdr World PR #20](https://github.com/IvoryHeart/herdr-world/pull/20)
- Fixed guided desktop setup bypassing an incompatible detached Herdr server merely because its
  socket still existed. Interactive launches now offer to install/update Herdr, explicitly warn and
  ask before stopping the old server, then start the compatible server in the selected workspace.
  [Herdr World PR #19](https://github.com/IvoryHeart/herdr-world/pull/19)
- Fixed the packaged launcher failing with `bridge_args[@]: unbound variable` when invoked without
  bridge arguments under the Bash 3.2 version shipped by macOS, and added a native packaged-launcher
  regression check. [Herdr World PR #18](https://github.com/IvoryHeart/herdr-world/pull/18)
- Made release aggregation accept the equivalent macOS Mach-O architecture descriptions emitted
  by macOS and Linux `file`, while still requiring the expected executable format and CPU.
  [Herdr World PR #17](https://github.com/IvoryHeart/herdr-world/pull/17)
- Made the release helper mark SemVer prerelease tags as GitHub prereleases automatically while
  leaving stable versions unchanged.
  [Herdr World PR #15](https://github.com/IvoryHeart/herdr-world/pull/15)
- Made release creation fail closed unless both `origin` URLs and the explicit GitHub CLI target
  resolve to `IvoryHeart/herdr-world`, preventing a checkout's default upstream from receiving a
  Herdr World release. [Herdr World PR #10](https://github.com/IvoryHeart/herdr-world/pull/10)
- Fixed icons rendering slightly off-center in square icon buttons by resetting
  browser-default button padding and removing the compensating filter-icon transform.
  Contributed by [Philippe SEGATORI (@tigitz)](https://github.com/tigitz) in
  [PR #55](https://github.com/kcosr/herdr-web/pull/55).
- Fixed the Pixel Office Economy board overflowing long Anthropic model names into the token
  column by displaying the model family and version only, for example `Haiku 4.5`.
- Fixed saved Office observability settings being applied after the first data refresh by waiting
  for configuration synchronization and the provider's initial Prometheus query.

- Fixed Office room roads being visually swallowed by room borders by widening
  the packed room gap to the road width, and corrected vertical-road lane marks
  to run vertically while horizontal-road marks remain horizontal.
- Increased the vertical gap between room rows so row headings no longer cover
  the horizontal road separator.
- Fixed development-mode Office renderer cleanup so an older asynchronous Pixi
  initialization cannot remove the active canvas created by a newer initialization.
- Mobile terminal copies now remove canvas row gaps that split HTTP(S) links, including indented
  alphanumeric continuations when terminal edge metadata is unavailable, while preserving ordinary
  line breaks.
  [PR #61](https://github.com/kcosr/herdr-web/pull/61)
