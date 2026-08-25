# Suggestions and idea register

This is a lightweight, non-binding list of possible improvements, experiments,
and product ideas for the Herdr Office project and its packages.

Suggestions are deliberately not specifications. They capture useful
possibilities without committing the project to a design, implementation, or
timeline. Once an idea is selected for implementation, it MUST be clarified in
an approved specification when it is non-trivial.

## How to use this list

- Anyone may add a suggestion.
- Give each suggestion a stable `SUG-NNN` identifier. Do not renumber or reuse
  identifiers.
- Keep the first entry short: the problem or opportunity matters more than a
  complete design.
- Name the package or packages that may own the work.
- Use `open` while an idea is worth considering, `candidate` when it is being
  actively evaluated, `promoted` when it has moved into a specification or
  issue, `parked` when it is intentionally deferred, and `declined` when the
  project has decided not to pursue it.
- Link a promoted suggestion to its specification. The suggestion remains as
  historical context; the specification becomes the implementation contract.
- Prefer updating an existing suggestion over adding a near-duplicate.

## Package vocabulary

Use the smallest useful scope. These names are labels, not repository mandates.

| Scope | Meaning |
| --- | --- |
| `herdr-server` | Herdr runtime, server API, lifecycle, or extension seam |
| `herdr-web` | Browser workspace, bridge, transport, and shared web surfaces |
| `bridge` | Host-local Herdr Web bridge and browser-facing protocol |
| `office-view` | Pixel Office presentation and Office interactions |
| `observability` | Shared contract, OTEL adapter, provider, and correlation |
| `packaging` | Installers, release assembly, version manifests, and services |
| `mobile` | Android or future mobile shells and narrow layouts |
| `devex` | Documentation, testing, diagnostics, and contributor workflow |
| `cross-cutting` | Work that intentionally spans multiple scopes |

## Suggestion template

```markdown
### SUG-NNN — Short idea name

- **Status:** open
- **Scope:** `office-view`
- **Value:** What user or project problem this could improve.
- **Idea:** One or two sentences describing the possibility.
- **Dependencies:** Optional packages, capabilities, or upstream work.
- **Owner:** Open | person/team
- **Added:** YYYY-MM-DD
- **Related:** Optional issue, spec, discussion, or design link.
```

## Promotion path

```text
suggestion
  → candidate review
  → approved specification
  → implementation
  → implementation summary
```

Small maintenance changes may go directly to an issue or task. The suggestion
register should not become a second issue tracker, project plan, or collection
of hidden requirements.

## Open suggestions

### SUG-001 — Upstream extension alignment and capability reuse

- **Status:** promoted
- **Scope:** `herdr-web`, `bridge`, `herdr-server`
- **Value:** Let future integrations reuse the correct Herdr plugin/API, Herdr
  Web capability, compiled surface, or provider boundary without creating a
  competing registry or duplicate source of truth.
- **Idea:** Classify each extension before implementation, reuse Herdr's
  canonical plugin/session APIs and Herdr Web's existing `/api/capabilities`,
  and allow a downstream provider contract only for a documented remaining
  semantic or historical-data gap.
- **Dependencies:** SUG-002 and the approved
  [`002-herdr-observability-extension-contract-spec.md`](specs/002-herdr-observability-extension-contract-spec.md).
- **Owner:** Open
- **Added:** 2026-08-06
- **Reassessed:** 2026-08-20. The earlier generic `/api/extensions` proposal was
  withdrawn after the current upstream audit found overlapping authoritative
  plugin discovery and browser capability mechanisms.
- **Related:** [`004-world-packaging-and-upstream-boundaries-spec.md`](specs/004-world-packaging-and-upstream-boundaries-spec.md)

### SUG-002 — OTEL-backed Office observability boards

- **Status:** open
- **Scope:** `observability`, `office-view`
- **Value:** Make agent activity, traces, logs, metrics, and later derived
  signals useful from the same Office context as the live terminal.
- **Idea:** Add optional Office boards and agent detail views backed by a
  versioned observability provider, with graceful absence when OTEL is not
  configured.
- **Dependencies:** Shared observability contract, target correlation, and a
  provider or OTEL adapter.
- **Owner:** Open
- **Added:** 2026-08-06
- **Related:** [`002-herdr-observability-extension-contract-spec.md`](specs/002-herdr-observability-extension-contract-spec.md)

### SUG-003 — Unified Herdr Office distribution

- **Status:** open
- **Scope:** `packaging`, `herdr-web`, `office-view`
- **Value:** Let users install and run the compatible Herdr runtime, web
  experience, bridge, Office view, and optional extensions as one product.
- **Idea:** Publish a version-pinned manifest, platform launchers, checksums,
  upgrade path, and a single user-facing command while preserving upstream
  component boundaries.
- **Dependencies:** Compatibility matrix, release automation, and upstream
  licensing/trademark review.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-004 — Multi-server bridge or connection coordinator

- **Status:** candidate
- **Scope:** `bridge`, `herdr-web`, `herdr-server`, `packaging`
- **Value:** Make several Herdr servers feel like one usable Office deployment
  without requiring users to manually understand bridge origins, tunnels, and
  authentication boundaries.
- **Idea:** Herdr Web already supports multiple independently qualified bridge
  profiles and operator-managed SSH forwarding. Improve onboarding and
  packaging around that capability without creating another profile store or
  coordinator. For terminal-native remote mirroring, evaluate Herdr's public
  session APIs and the `herdr-mirror` plugin before adding browser transport.
  The browser should never manage or persist SSH private keys; SSH, VPN, or an
  authenticated reverse proxy can remain an operator responsibility unless an
  upstream contract provides a safer supported alternative.
- **Dependencies:** Herdr authentication capabilities, host identity and
  discovery, secure transport choice, origin/CSP policy, failure isolation,
  per-host permissions, and a dedicated architecture spec.
- **Owner:** Open
- **Added:** 2026-08-06
- **Related:** [Federation guidance](federation.md)
- **Related upstream evidence:**
  [`nikok6/herdr-mirror`](https://github.com/nikok6/herdr-mirror) and
  [Herdr discussion #515](https://github.com/herdrdev/herdr/discussions/515)
- **Current slice:** Direct browser federation remains the supported boundary.
  Settings now offers an explicit Enable all / Disable all action for saved
  bridge profiles, while probes and failures remain isolated per host. A
  central authenticated coordinator remains deferred and MUST have a concrete
  auth/discovery gap beyond existing Web federation and public Herdr session
  APIs before it is proposed.

### SUG-005 — Office provider and host health panel

- **Status:** candidate
- **Scope:** `office-view`, `observability`
- **Value:** Make stale, disconnected, incompatible, or degraded data sources
  understandable without inspecting browser logs.
- **Idea:** Add a compact status surface showing Herdr bridge health,
  observability provider health, freshness, and the reason a capability is
  unavailable.
- **Dependencies:** Capability and health contract.
- **Owner:** Open
- **Added:** 2026-08-06
- **Current slice:** Persistent notice-strip health text was removed to return
  the space to the Office canvas. Host and Economy details remain available in
  the shared sidebar, Office settings, and the existing CEO boards; a fuller
  freshness/details panel remains open for a later pass.

### SUG-006 — Agent activity timeline

- **Status:** open
- **Scope:** `office-view`, `observability`
- **Value:** Give users a concise history of what an agent has been doing,
  beyond its current animated state.
- **Idea:** Show bounded, correlated events such as state changes, tool calls,
  approvals, errors, and completed work next to the live terminal.
- **Dependencies:** Event ordering, retention limits, privacy review, and an
  observability provider.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-007 — Saved Office layouts and views

- **Status:** promoted
- **Scope:** `office-view`
- **Value:** Let users return to a useful arrangement of terminal windows,
  boards, filters, and host scope.
- **Idea:** Save named Office view presets without persisting terminal content
  or silently changing Herdr runtime state.
- **Dependencies:** Multi-window lifecycle, responsive-layout decision, and
  explicit persistence/privacy rules.
- **Owner:** Open
- **Added:** 2026-08-06
- **Current slice:** The Office now restores bounded browser-local conversation
  geometry, window order, and scene scroll position after refresh. Named view
  presets, filters, and cross-device synchronization remain deferred.
- **Related:** [`008-office-productivity-ux-spec.md`](specs/008-office-productivity-ux-spec.md)

### SUG-008 — Office accessibility and presentation modes

- **Status:** open
- **Scope:** `office-view`, `mobile`
- **Value:** Make the visual Office useful for more users and environments.
- **Idea:** Add high-contrast, reduced-motion, larger-label, colour-blind-safe,
  keyboard-navigation, and screen-reader-friendly modes while retaining the
  pixel-art presentation.
- **Dependencies:** Accessibility audit and visual token cleanup.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-009 — Office navigation aids

- **Status:** open
- **Scope:** `office-view`
- **Value:** Reduce effort when the Office grows beyond a single screen.
- **Idea:** Add optional zoom, minimap, room/host search, focus navigation, and
  a compact overview of open terminal windows.
- **Dependencies:** Responsive-layout decision, interaction design, and
  performance measurements for large rosters.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-010 — Contributor and extension development kit

- **Status:** open
- **Scope:** `devex`, `herdr-web`, `herdr-server`, `observability`
- **Value:** Allow future contributors to add providers or Office surfaces
  without learning every internal implementation detail.
- **Idea:** Point executable workflow authors to the upstream Herdr plugin
  manifest, examples, CLI, socket API, and terminal session streams. Provide
  World-local fixtures and harnesses only for compiled browser surfaces and
  provider contracts, with a decision guide that prevents either from being
  presented as a new plugin system.
- **Dependencies:** Approved Specs 004, 010, and 011; evidence that at least two
  independent World surfaces or provider integrations need the same authoring
  hook before publishing a World-specific kit.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-011 — Scoped Office and Herdr Web settings

- **Status:** promoted
- **Scope:** `office-view`, `herdr-web`
- **Value:** Let users tune the experience without mixing product preferences
  with Herdr runtime configuration.
- **Idea:** Define which settings belong to shared Herdr Web and which belong
  only to Office, then provide a discoverable settings surface with clear
  defaults and per-device persistence.
- **Dependencies:** Settings ownership model, packaging defaults, and mobile
  persistence decisions.
- **Current refinement:** The first concrete candidate is implemented as a
  removable Office-only settings slice: an optional Prometheus URL with health
  feedback and explicit bridge-boundary/security rules. See
  [`006-office-observability-settings-spec.md`](specs/006-office-observability-settings-spec.md).
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-012 — Theme and terminal appearance presets

- **Status:** open
- **Scope:** `office-view`, `herdr-web`
- **Value:** Improve readability and let users choose a comfortable visual
  environment.
- **Idea:** Add light/dark or system appearance modes, Office palette presets,
  and terminal colour presets without changing Herdr terminal semantics.
- **Dependencies:** Shared design tokens, terminal theme ownership, and
  accessibility contrast checks.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-013 — Configurable terminal opening policy

- **Status:** open
- **Scope:** `office-view`
- **Value:** Let users decide whether passive agents should immediately become
  interactive terminals.
- **Idea:** Add toggles for automatically opening or only offering a terminal
  for agents in reception, agents in the bar, idle agents, or other selected
  states.
- **Dependencies:** Multi-window lifecycle, notification behaviour, and a
  non-disruptive default policy.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-014 — Short agent activity callouts

- **Status:** open
- **Scope:** `office-view`, `observability`
- **Value:** Give the Office scene a concise, human-readable explanation of
  what an agent has completed or is waiting for.
- **Idea:** Show an optional five-to-eight-word callout for reception or bar
  agents, such as “I just wrote a new spec” or “I delivered PR-256”. The
  source, freshness, truncation, and fallback text should be explicit.
- **Dependencies:** Agent activity/observability contract, privacy rules, and
  bounded text generation or source metadata.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-015 — Harness-provided agent avatars

- **Status:** open
- **Scope:** `office-view`, `observability`
- **Value:** Make agents recognisable and preserve useful identity cues from
  the harnesses already running them.
- **Idea:** Prefer a harness-provided avatar when available, fall back to the
  current Office character set, and support basic animation first with richer
  avatar capabilities added only when the source contract supports them.
- **Dependencies:** Avatar metadata contract, asset licensing, image loading,
  privacy, accessibility, and animation performance.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-016 — Agent Bar art and atmosphere pass

- **Status:** open
- **Scope:** `office-view`
- **Value:** Make the bar feel like a coherent shared space rather than a
  collection of separate sprites.
- **Idea:** Rework the bar composition, counter, stools, bottles, board,
  lighting/floor treatment, spacing, and decorative details as one art pass.
- **Dependencies:** Existing art licensing, pixel-art asset workflow, and a
  visual review session.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-017 — Continuous agent movement animation

- **Status:** open
- **Scope:** `office-view`
- **Value:** Make state changes easier to follow and reduce the feeling that
  agents teleport between reception, rooms, and the bar.
- **Idea:** Animate an agent's movement between stable scene anchors, with a
  sensible fallback for off-screen, stale, or rapidly changing destinations.
- **Dependencies:** Stable scene identity, renderer lifecycle, connector
  continuity, reduced-motion support, and performance testing.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-018 — CEO and reception spacing refinement

- **Status:** promoted
- **Scope:** `office-view`
- **Value:** Use the CEO band more efficiently while preserving legible blocks
  and clear click targets.
- **Idea:** Reduce the spacing between the CEO table, board, and reception
  tables—potentially by approximately 50%—then rebalance labels, chairs, and
  connector clearance as one layout adjustment.
- **Dependencies:** Visual review, minimum viewport widths, host-count
  overflow behaviour, and accessibility hit targets.
- **Owner:** Open
- **Added:** 2026-08-06
- **Current slice:** The CEO/reception block gap is tighter while preserving
  the existing furniture and hit-target model.
- **Related:** [`008-office-productivity-ux-spec.md`](specs/008-office-productivity-ux-spec.md)

### SUG-019 — Dedicated mobile Office composition

- **Status:** open
- **Scope:** `office-view`, `mobile`
- **Value:** Make the Office useful on a phone instead of shrinking the desktop
  scene until it becomes difficult to navigate.
- **Idea:** Provide a mobile-specific composition with the CEO board and
  reception queue as the first screen, represent the CEO table as an icon,
  remove or reduce reception furniture, and present agents as a directly
  selectable queue.
- **Dependencies:** Mobile navigation model, saved view state, touch target
  rules, terminal presentation, and a separate mobile visual spec.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-020 — Large semantic mobile hit targets

- **Status:** open
- **Scope:** `office-view`, `mobile`
- **Value:** Make desks, agents, and rooms reliably selectable on touch screens
  even when their art remains compact.
- **Idea:** Give each desk or desk-agent grouping a generous semantic hit area,
  preserve exact target identity, and expose an accessible list or queue when
  the pixel art cannot provide enough space.
- **Dependencies:** Mobile composition, target qualification, touch feedback,
  keyboard accessibility, and duplicate-selection handling.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-021 — Agent, room, and Office cost attribution

- **Status:** open
- **Scope:** `observability`, `office-view`
- **Value:** Make resource usage visible where users already understand agent
  activity and ownership.
- **Idea:** Once observability integration is available, show the cost spent
  or currently accumulating for each agent, aggregate costs for each room, and
  provide a CEO-office board with overall totals and useful time-window
  comparisons.
- **Dependencies:** Provider cost data, agent/session attribution, room and
  host aggregation, currency and time-window settings, estimated-versus-final
  status, privacy rules, and bounded board presentation.
- **Owner:** Open
- **Added:** 2026-08-06

### SUG-022 — Contextual agent and desk hover callouts

- **Status:** promoted
- **Scope:** `office-view`, `herdr-web`, `observability`
- **Value:** Let users understand what an agent or desk represents without
  opening a terminal or leaving the Office view.
- **Idea:** Hovering an agent should show a compact, non-interactive callout
  such as “Codex is idle for 12 minutes”, “I completed the task”, or “I am
  busy with <task>”. Hovering an empty desk should explain the attached shell
  and current status, for example “Shell is idle”. The callout should prefer
  authoritative state labels and summaries, then fall back to agent identity,
  status, terminal title, workspace, or current directory.
- **Dependencies:** Existing pane status/title/cwd fields, status-change timing
  for duration text, future task summaries or observability data, bounded text
  and privacy rules, touch/keyboard alternatives, and tooltip placement around
  movable Office terminals.
- **Owner:** Open
- **Added:** 2026-08-09
- **Related:** [`007-office-ux-and-seat-actions-spec.md`](specs/007-office-ux-and-seat-actions-spec.md)

### SUG-023 — Harness-reported task summaries

- **Status:** promoted
- **Scope:** `herdr-server`, `herdr-web`, `observability`, `office-view`
- **Value:** Show what an agent is actually doing or has just completed using
  information reported by the harness, rather than guessing from screen text.
- **Idea:** Extend or reuse Herdr's agent metadata/reporting path so a harness
  can provide a short, bounded summary associated with the exact agent session
  and pane. Herdr Web should forward the trusted metadata and Office should
  prefer it for hover callouts, reception/bar announcements, and later agent
  timelines. The current status, state label, terminal title, and directory
  remain fallbacks when a harness does not provide a summary.
- **Dependencies:** Existing harness/session identity, Herdr agent metadata
  reporting, bridge/web schema exposure, summary source and freshness, expiry
  or TTL, privacy filtering, prompt/log redaction, and upstream agreement on a
  stable field or extension hook.
- **Owner:** Open
- **Added:** 2026-08-09
- **Current slice:** Herdr Web accepts optional `task_summary` metadata on
  snapshots and activity messages, bounds it, and surfaces it as a persistent
  selected-agent Office callout. A native producer, TTL, privacy filter, and
  upstream contract remain deferred.
- **Related:** [`008-office-productivity-ux-spec.md`](specs/008-office-productivity-ux-spec.md)
- **Related:** [`002-herdr-observability-extension-contract-spec.md`](specs/002-herdr-observability-extension-contract-spec.md)

### SUG-024 — Visible completion rendezvous and acknowledgement

- **Status:** promoted
- **Scope:** `office-view`, `herdr-web`, `observability`
- **Value:** Make completion chimes actionable by showing exactly which agent
  or desk produced the event.
- **Idea:** Let the completed agent move to the Agent Bar as idle while leaving
  a generic completed-work marker at the originating desk. Add a brief room or
  desk highlight and a clear interaction that opens the exact terminal. The
  marker can use document sheets lying on the desk or hanging/floating above
  it as a generic office metaphor; it should not guess whether the work was a
  document, package, pull request, or another artifact until harness-specific
  reporting is understood.
- **Dependencies:** Herdr completion/status events, event-to-agent identity,
  notification correlation, distinct marker art, implicit inspection
  semantics, idle/done state projection, multi-window terminal behaviour, and
  accessibility/reduced-motion support.
- **Owner:** Open
- **Added:** 2026-08-09
- **Related:** [`003-office-completion-rendezvous-spec.md`](specs/003-office-completion-rendezvous-spec.md)

### SUG-025 — Fluid unit-based Office rooms

- **Status:** promoted
- **Scope:** `office-view`
- **Value:** Make room composition scale with the number of desks and chairs
  instead of forcing every room into the same rigid footprint.
- **Idea:** Define a standard room/tile unit, then compose two-chair, four-chair,
  and larger rooms from those units. Preserve readable art, semantic hit areas,
  connector anchors, and sensible minimum sizes; defer the work if fluid
  geometry makes the scene materially harder to understand or maintain.
- **Dependencies:** Scene layout model, stable anchor coordinates, connector
  routing, room overflow rules, visual review, and later responsive-layout
  decisions.
- **Owner:** Open
- **Added:** 2026-08-10
- **Current slice:** Room widths and local desk/standing columns now derive from
  each room's contents while retaining minimum dimensions and inter-room gaps.
- **Related:** [`008-office-productivity-ux-spec.md`](specs/008-office-productivity-ux-spec.md)

### SUG-026 — Add-seat and new Herdr session action

- **Status:** promoted
- **Scope:** `office-view`, `herdr-web`, `bridge`
- **Value:** Let a user create another interactive shell directly from the
  Office instead of first leaving the visual workspace.
- **Idea:** Add a clearly discoverable `+` action that requests a new Herdr
  session or pane, creates a corresponding seat/desk when the runtime accepts
  it, and opens the new terminal. The UI should report unsupported permissions
  or unavailable session creation rather than displaying a seat that is not
  backed by a real runtime session.
- **Dependencies:** Bridge/session-creation protocol, Herdr permissions,
  host/profile ownership, terminal-window limits, room allocation, lifecycle
  reconciliation, and accessible action feedback.
- **Owner:** Open
- **Added:** 2026-08-10
- **Current slice:** The Office now exposes a capability-gated `New room` action
  plus selected-room rename and close controls. These issue the native Herdr
  workspace lifecycle commands and create real named workspaces; the Office
  does not maintain a separate room model.
- **Related:** [`007-office-ux-and-seat-actions-spec.md`](specs/007-office-ux-and-seat-actions-spec.md)

### SUG-027 — Restore open terminal windows after refresh

- **Status:** candidate
- **Scope:** `herdr-web`, `office-view`
- **Value:** Prevent a browser refresh from losing the user's active terminal
  workspace and forcing them to rediscover each session.
- **Idea:** Persist only lightweight, browser-local window descriptors—such as
  qualified host/profile, pane or session identity, geometry, and visibility—
  then revalidate every descriptor against the bridge after reload. Restore
  only sessions that are still reachable and authorized, and discard stale
  descriptors cleanly. A short-lived `sessionStorage` model could cover tab
  refreshes; durable `localStorage` or IndexedDB should be an explicit opt-in
  if restoration across browser restarts is later wanted.
- **Dependencies:** Stable qualified session identity, bridge revalidation,
  multi-window lifecycle, close/expiry handling, clear/reset controls, and
  privacy/security review. Do not persist terminal buffers, command content,
  authentication tokens, or SSH private keys; cookies are not the right storage
  mechanism for this UI state.
- **Owner:** Open
- **Added:** 2026-08-10
- **Current slice:** Office keeps short-lived qualified pane descriptors in
  `sessionStorage`, rebinds them to a new bridge generation, and drops them
  when an admitted snapshot confirms the pane is gone. Geometry persistence
  and cross-restart restoration remain intentionally deferred.

### SUG-028 — Smooth Office terminal refit during resize

- **Status:** promoted
- **Scope:** `office-view`, `herdr-web`
- **Value:** Keep the terminal canvas visually aligned with its Office
  conversation window while the user drags or resizes it.
- **Idea:** Reduce the visible catch-up blink between the outer conversation
  geometry and the inner Ghostty terminal refit. Investigate a frame-aligned
  measurement path and the stacked `ResizeObserver`/fit debounce without
  increasing backend resize traffic or weakening terminal lifecycle guards.
- **Dependencies:** Ghostty FitAddon behavior, ResizeObserver timing, pointer
  and keyboard resize paths, and a reproducible CI trace for the existing
  resize instability.
- **Owner:** Open
- **Added:** 2026-08-11
- **Current slice:** The embedded terminal's ResizeObserver path now refits on
  the next animation frame, removing the extra trailing debounce that made the
  inner canvas visibly lag the outer Office window. The renderer scene-build
  guard remains a separate follow-up if field use still exposes a delay.
- **Related:** [`008-office-productivity-ux-spec.md`](specs/008-office-productivity-ux-spec.md)
- **Related:** [Issue #7](https://github.com/IvoryHeart/herdr-web/issues/7)

## Parked or declined

Move suggestions here when they are intentionally deferred or rejected, while
preserving the original identifier and the reason for the decision.
