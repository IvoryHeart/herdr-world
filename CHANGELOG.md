# Changelog

## [Unreleased]

### Breaking Changes

### Added

### Changed

- Made the desktop launcher detect a missing default Herdr session and offer an explicit,
  consent-based path to install Herdr from its official installer and start it in a user-selected
  workspace. Non-interactive, custom-session, and custom-socket launches remain fail-safe.
- Added a direct, checksum-verified Linux release quick start, an explicit public-platform matrix,
  a minimalist Pixel Office-themed GitHub Pages site, and launch-ready social artwork for the
  Herdr World public preview.
  [Herdr World PR #11](https://github.com/IvoryHeart/herdr-world/pull/11)

### Fixed

- Made release creation fail closed unless both `origin` URLs and the explicit GitHub CLI target
  resolve to `IvoryHeart/herdr-world`, preventing a checkout's default upstream from receiving a
  Herdr World release. [Herdr World PR #10](https://github.com/IvoryHeart/herdr-world/pull/10)

### Removed

## [0.1.0-rc.1] - 2026-08-26

### Added

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

## [0.4.1] - 2026-08-05

### Breaking Changes

- Herdr `v0.8.0` or newer with terminal protocol exactly `19` is now required. The bridge rejects
  the previous protocol `17` baseline and other unreviewed protocols instead of attempting a
  backward-compatible wire fallback. [PR #48](https://github.com/kcosr/herdr-web/pull/48)

### Added

- Added a contextual Move Space mode to the Spaces menu. The selected space card becomes draggable,
  retains a cancel control and arrow/Home/End keyboard support, mutes unrelated sidebar actions
  until the move is completed or canceled, and moves worktree groups atomically within their host's
  canonical workspace order. [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Added persistent expand/collapse controls to grouped Agents, Tabs, and Spaces headers, including
  independent, visually nested host and workspace controls for Host + workspace grouping and a
  bulk expand/collapse control for the current Agents or Tabs list.
  [PR #47](https://github.com/kcosr/herdr-web/pull/47)
- Added a default-off Display setting that combines same-named workspaces across hosts when using
  Workspace grouping, while retaining host context on each agent or pane row.
  [PR #47](https://github.com/kcosr/herdr-web/pull/47)

### Changed

- Refreshed the minimal vendored Herdr compatibility sources to the `v0.8.0`/protocol `19`
  baseline, including the current API schemas, terminal wire definitions, and input model shims.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Follow Herdr's canonical workspace order when atomic worktree groups are reordered.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Simplified Workspace grouping in the Agents and Tabs sidebars to show workspace-only group
  headers and move host context into each detail row. Host + workspace grouping keeps its nested
  host and workspace headers. [PR #47](https://github.com/kcosr/herdr-web/pull/47)

### Fixed

- Fixed built-in agent launches against Herdr `v0.8.0` by waiting for a newly created pane's shell
  to become available before starting the managed agent.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)

## [0.4.0] - 2026-07-30

### Breaking Changes

- Herdr `v0.7.5` or newer with terminal protocol exactly `17` is now required. The bridge rejects
  older protocol `16` daemons and unreviewed newer protocols rather than attempting a
  backward-compatible wire fallback. [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Removed the obsolete `custom_status` field from bridge snapshots and activity events; agent
  presentation now uses Herdr's `state_labels`, title, display-agent, and status fields.
  [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Changed the default ungrouped Tabs and Spaces sidebar presentation to compact rows with inline
  host, Space, and tab context instead of contextual headers. Agent panes in Tabs also use the
  Agents row presentation and agent-aware ordering by default. Choose a grouping mode to restore
  contextual headers, or disable Agent features in Tabs to restore generic pane rows and the
  original tab order. [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Added

- Added a default-on client-local Sync navigation setting. Browser tabs and windows with sync off
  can view different panes through the same bridge without publishing or following shared pane
  selection or changing Herdr's focused tab through ordinary navigation.
  [PR #42](https://github.com/kcosr/herdr-web/pull/42)
- Added default-on Agent features in Tabs, including consistent Agents row metadata and pin
  placement, agent-aware sorting, and pinned-only and active-only filters. Non-agent tabs remain
  visible at the bottom of agent-aware sorts; disabling the setting restores generic pane rows.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)
- Added multi-host Spaces controls: Spaces can be shown as a flat list with host context or grouped
  under host headers, and the default-on Multi-host Space selection setting can be disabled to limit
  Space-scoped Agents, Tabs, and Notes to one globally selected Space. All scope remains unchanged.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Changed

- Refreshed the minimal vendored Herdr compatibility sources to the `v0.7.5`/protocol `17` baseline,
  including the current API schemas and terminal wire definitions.
  [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Updated launching for Herdr `v0.7.5`: built-in agents use the managed `agent.start` flow after the
  destination pane is created. The bridge waits for interactive readiness and rolls back its new
  tab or pane after rejection, early process exit, or timeout. Custom launcher presets continue to
  execute their exact configured `argv`. [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Store the Sync navigation setting browser-wide while keeping sync-off pane selections only in
  memory. The app no longer creates per-tab navigation storage records.
  [PR #43](https://github.com/kcosr/herdr-web/pull/43)
- Simplified agent-row metadata by removing generic status text already communicated by the status
  indicator and badge, while retaining bridge-defined state labels.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Fixed

- Cleared and remounted the mobile terminal command field after Send or Stage so stale native input
  cannot prefix the next command. [PR #44](https://github.com/kcosr/herdr-web/pull/44), with an
  earlier implementation contributed by
  [Alexander Makarov (@AlexanderMakarov)](https://github.com/AlexanderMakarov) in
  [PR #38](https://github.com/kcosr/herdr-web/pull/38).
- Fixed client-local navigation synchronization across reloads, reconnects, lagging snapshots, and
  rapid multi-client selection races. Sync-off split navigation now stays local, and independent
  clients no longer rewrite shared navigation persistence. After a bridge restart, the focused
  Herdr pane now seeds shared navigation so synced clients immediately converge.
  [PR #43](https://github.com/kcosr/herdr-web/pull/43)

## [0.3.3] - 2026-07-19

### Added

- Added Grok and OpenCode agent icons in the Agents sidebar and create-menu launch choices.
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)
- Added built-in launcher presets for Grok and OpenCode (`builtin:grok`, `builtin:opencode`).
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)
- Added optional `builtins` allowlist/order in `launcher-presets.json` so the create menu can show a
  subset of built-ins without PATH probing. Omitting `builtins` keeps the full default set; `[]`
  hides all built-ins (custom presets still appear). Short names (`shell`) and full ids
  (`builtin:shell`) are accepted; unknown entries warn and are ignored.
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)

### Fixed

- Kept the first selected character anchored during mobile endpoint dragging, aligned the loupe caret
  with the selected row, and centered a hollow drag handle over the anchored character.
  [PR #35](https://github.com/kcosr/herdr-web/pull/35)

## [0.3.2] - 2026-07-07

### Breaking Changes

- Users must upgrade Herdr to `v0.7.2` or newer before upgrading herdr-web. The bridge now requires
  a Herdr daemon with protocol `16` because browser snapshots use Herdr's native
  `session.snapshot` API.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)

### Added

- Added an Agents-view active-status filter that shows only agents currently
  marked working, blocked, or done, with grouped views hiding empty groups after
  filtering. [PR #31](https://github.com/kcosr/herdr-web/pull/31)

### Changed

- Refreshed the vendored Herdr compatibility baseline to `v0.7.2`, including protocol `16`, native
  session snapshots, layout/scroll event schema drift, and terminal observe/control wire messages.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)
- Changed `/api/snapshot` to use one native Herdr `session.snapshot` request instead of separate
  workspace, tab, pane, and per-tab layout requests.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)

## [0.3.1] - 2026-07-03

### Added

- Added bridge-owned configurable launcher presets for the create menu, including argv-based custom
  agent commands, optional Herdr agent hints, and horizontally scrollable launch choices.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)
- Documented macOS x86_64 desktop tarball support alongside Linux x86_64 and macOS ARM64 release
  artifacts.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)
- Refreshed the vendored Herdr compatibility baseline to `v0.7.1` for launcher preset agent hints.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)

### Fixed

- Fixed mobile sidebar space selection so tapping a space updates the scoped Tabs list instead of
  snapping back to tabs from the previously selected pane.
  [PR #29](https://github.com/kcosr/herdr-web/pull/29)
- Fixed a bridge reattach race where a client reconnecting right after the last viewer left a
  terminal could be rejected by the daemon with `already has an attached client` and shown a
  permanent `Attached elsewhere` error; the bridge now shuts detached attach connections down and
  reattaches only after the pending detach has been delivered.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)
- Stopped detached terminal attach connections from leaking a blocked reader thread and an open
  socket on both the bridge and daemon sides after every pane switch.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)
- Serialized concurrent first attaches per terminal in the bridge and made the web client briefly
  retry `already has an attached client` rejections, so multiple viewers reconnecting at once
  (for example after a bridge restart) no longer strand a terminal on a permanent
  `Attached elsewhere` error. The bridge also now logs daemon-initiated attach connection closes,
  which were previously recorded nowhere.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)

## [0.3.0] - 2026-07-02

### Added

- Added an `Add note` action to pane and agent sidebar context menus, opening a quick-create
  dialog with a focused title and optional body that attaches the new note to the target pane.
  [PR #24](https://github.com/kcosr/herdr-web/pull/24)
- Added Mobile settings for an expanding terminal command input and Enter-as-newline
  editing, allowing long prompts to wrap and remain viewable while preserving send-on-Enter
  by default. [PR #21](https://github.com/kcosr/herdr-web/pull/21)
- Added bridge-tracked agent status transition activity with an Agents view sort option for
  `Last status change`, using semantic status changes rather than terminal output activity.
  [PR #23](https://github.com/kcosr/herdr-web/pull/23)
- Added server-side agent pins with pinned-first agent ordering, a pinned-only sidebar toggle, and
  a selected-pane header toggle plus a small pinned indicator on pinned agent rows.
  [PR #22](https://github.com/kcosr/herdr-web/pull/22)
- Added bridge-owned pane notes with a sidebar Notes view, desktop/mobile notes editor, pane
  attachment recovery states, and per-bridge note synchronization. Notes are exposed through the
  same bridge request policy as terminal controls, so allowed bridge clients can read and mutate
  saved note content. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Added a Notes feature toggle plus persisted desktop notes panel sizing, notes list collapse
  state, notes panel open state, pane note tabs, and a dedicated Other notes list.
  [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Added a Markdown preview mode for notes that remembers Edit/Preview preference locally and keeps
  the Markdown renderer lazy-loaded until preview is used. [PR #20](https://github.com/kcosr/herdr-web/pull/20)

### Changed

- Unified the `session_key` reported by `/api/agent-activity` with the notes and agent-pins
  endpoints (`session:default` and FNV-1a socket hashes instead of a divergent local format).
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Extended the pinned-only sidebar toggle to the Tabs view so pinned panes can be found outside the
  Agents view. [PR #23](https://github.com/kcosr/herdr-web/pull/23)
- Notes created from the notes panel now open in Edit mode with the title selected, so the default
  title can be replaced immediately. [PR #24](https://github.com/kcosr/herdr-web/pull/24)

### Fixed

- Made the bridge close and cleanly reattach terminal sockets that fall behind fast output instead
  of silently dropping frames and corrupting the rendered stream.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Moved the bridge's remaining blocking daemon round-trips (snapshot, selection, agent activity,
  rename-label lookups) off async worker threads, so a stalled daemon no longer freezes unrelated
  requests and terminal websockets.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Bounded the bridge's per-terminal input queue so a client sending faster than the pty drains no
  longer grows bridge memory without limit.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Fixed terminal session races where a client connecting while the previous one disconnected could
  be handed an already-detached session, and where the daemon handshake blocked all other terminal
  clients.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Stopped the bridge from silently tightening permissions on a pre-existing operator-supplied
  `--upload-dir`; only directories the bridge creates itself are set to 0700.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Applied the standard 120-byte label validation to `pane.rename` requests, matching every other
  rename/create command.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Stopped a cancelled terminal mount from leaking an orphaned renderer and duplicated canvas when
  the pane changes while the terminal module is still loading.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made single-cell touch selections highlight correctly instead of silently storing a wrong
  scrollback row.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Preserved combining characters and multi-codepoint emoji when copying terminal text via touch
  selection.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Kept the selected note open while no pane is selected, so notes no longer deselect mid-edit when
  a bridge disconnects, has zero panes, or a notes refresh lands.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made Escape in settings number fields discard the typed value instead of committing it, and stop
  it from closing the whole settings dialog; out-of-range numbers now snap back to the clamped
  value in the field.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Reordered Android hardware-back handling so open menus and dialogs close before the notes panel
  underneath them.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made Escape cancel the rename dialog from any focused control, not just the text input.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Extended long-press text-selection prevention to the stage header pane title.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Restored the intended drop shadow and muted URL color on the terminal selection sheet, which
  referenced undefined CSS variables.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Validated agent-pins responses at the fetch boundary so a malformed bridge response degrades
  gracefully instead of crashing the sidebar render.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Prevented sidebar row labels and terminal tab labels from being text-selected during long-press
  context-menu gestures. [PR #24](https://github.com/kcosr/herdr-web/pull/24)
- Fixed notes editor selection and autosave edge cases so switching to panes without notes clears
  the editor, deleting the selected note no longer shows a deleted note, and stale local save
  refreshes do not appear as external note changes. Also fixed mobile delete-dialog back handling
  and unresolved note recovery actions in the notes panel. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- On mobile, kept the note editor's terminal action available for the current pane and made it
  close the full-screen notes surface. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Changed mobile notes back navigation so back closes the notes surface from the editor, while a
  separate header button shows the notes list. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Kept the new-tab button pinned at the right edge of the top tab bar while the tab list scrolls.
  [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Improved terminal reconnect/resume handling so Android foregrounding and quick terminal switches
  keep the renderer stable, avoid stale tab flashes, and suppress transient connecting overlays.
  [PR #19](https://github.com/kcosr/herdr-web/pull/19)

## [0.2.1] - 2026-06-20

### Added

- Added a Terminal font size setting. [PR #16](https://github.com/kcosr/herdr-web/pull/16)
- Added desktop click-to-open support for detected HTTP(S) terminal URLs.
  [PR #16](https://github.com/kcosr/herdr-web/pull/16)

### Changed

- Added a Mobile setting for long-press behavior, with Off, Copy, and Loupe modes; Loupe uses a
  two-stage endpoint flow, selected URLs keep the action sheet, and tapped HTTP(S) URLs open
  directly; original mobile selection work contributed by Will Hampson.
  [PR #16](https://github.com/kcosr/herdr-web/pull/16)

### Fixed

- Fixed Android/tablet bridge color picker dismissal so saving a backend after choosing a color
  keeps the Settings dialog open. [PR #16](https://github.com/kcosr/herdr-web/pull/16)
- Fixed sidebar keyboard shortcuts so agent and tab navigation follows the visible host/sidebar
  order across selected-host and all-host views. [PR #18](https://github.com/kcosr/herdr-web/pull/18)

## [0.2.0] - 2026-06-19

### Added

- Added multi-bridge connections, allowing multiple saved bridges to stay enabled at once with
  server chips and an all-agents sidebar overview. [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added a bridge `--allow-connect-origin` option so bridge-served web pages can opt into connecting
  to other trusted bridge origins without relaxing the default Content Security Policy.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added a Host + workspace grouping option for agent lists.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added configurable bridge colors with a mobile-friendly color picker.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)

### Changed

- Moved sidebar agent/tab sorting and grouping controls into a vertical options menu, and removed
  redundant host prefixes from grouped tab labels. [PR #17](https://github.com/kcosr/herdr-web/pull/17)

## [0.1.2] - 2026-06-18

### Added

- Added a bridge-owned agent activity stream so pane status, title, display agent, and custom
  status updates reach connected browsers without waiting for a full snapshot refresh; concepts
  derived from the @roy-levi-amazon fork. [PR #11](https://github.com/kcosr/herdr-web/pull/11)
- Added Display settings for top/bottom app padding and mobile terminal controls size.
  [PR #13](https://github.com/kcosr/herdr-web/pull/13)
- Added configurable terminal input transport, with binary payload concepts derived from the
  @roy-levi-amazon fork. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Added opt-in terminal input batching controls with a fixed 32-byte flush threshold for slow
  connections. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Added a Shift-Tab key to the expanded mobile terminal key panel. [PR #11](https://github.com/kcosr/herdr-web/pull/11)

### Changed

- Coalesced fast terminal output bursts in the bridge before forwarding them to browser clients,
  with a per-client Terminal output batching setting for tuning frame churn during rapid TUI
  redraws; concepts derived from the @roy-levi-amazon fork.
  [PR #14](https://github.com/kcosr/herdr-web/pull/14)
- Reworked Settings into Bridge, Terminal, and Mobile areas, with horizontal area tabs on narrow
  screens. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Improved browser startup by lazy-loading the terminal renderer with retry after load failures,
  adding installable mobile web app metadata and raster icons, and compressing static
  bridge-served web assets; concepts derived from the @roy-levi-amazon fork.
  [PR #10](https://github.com/kcosr/herdr-web/pull/10)

## [0.1.1] - 2026-06-17

### Breaking Changes

### Added

- Added a native Android setting, on by default, to blur text inputs and refit the terminal after
  the keyboard closes.
- Added an opt-in mobile terminal long-press selection setting with drag-to-copy selection, selected
  URL actions, and touch hit-testing for Ghostty-detected links.

### Changed

- Changed bridge URL validation so users can save HTTP bridge URLs at any valid host or IP address.

### Fixed

- Forced and reapplied Android dark system bar styling with light status/navigation bar icons.
- Removed duplicate bottom safe-area padding inside the mobile terminal controls.

### Removed

## [0.1.0] - 2026-06-16

### Added

- Initial release.
