# Changelog

This changelog records Herdr World releases and downstream changes. Each release identifies the
exact [Herdr Web](https://github.com/kcosr/herdr-web) baseline from which it was derived; Herdr
Web's own release history remains in its upstream changelog.

## [Unreleased]

### Breaking Changes

### Added

- Added an accessible live Graph theme with bounded project/space and attached-terminal topology,
  detected agent or empty-shell identity, stable force layout, search, collapse, pan/zoom/fit
  controls, semantic navigation, connected live terminal overlays, and explicit Open-in-Spaces
  handoff.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

### Changed

- Made Office the default `/` experience, moved Spaces to `/spaces`, retained `/world` as a
  compatibility alias, replaced the Office tab with an Office/Graph World theme selector, made a
  fitted camera the fresh Graph default, and unified the initial Graph and Office terminal window
  footprint.
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

### Removed

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
