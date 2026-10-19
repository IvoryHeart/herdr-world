## 1. Model and placement

- [x] 1.1 Implement the board model as a pure projection of World's bounded topology (hosts, workspaces, tabs, status) plus board items; verify completeness against the maximum-scale fixture.
- [x] 1.2 Implement free-space placement, offsets and tidy (selection or whole board, with undo) as pure functions; verify non-overlap, stability under topology changes and zoom independence in unit tests.
- [x] 1.3 Implement the short-lived physics (springs to anchor plus offset, overlap resolution, throw with friction, cooling to rest); verify it reaches rest within the time bound and writes offsets.

## 2. Board view

- [x] 2.1 Add Board as a World view next to Graph (route, view switcher, phone navigation) with DOM cards, the SVG string layer, host zones, pan, wheel and pinch zoom, zoom controls and fit.
- [x] 2.2 Add semantic zoom (overview with workspace status squares; tabs return when zoomed in) with hysteresis; verify at desktop and 390 px browser sizes.
- [x] 2.3 Add fold and unfold into free space, pinning, tidy with undo, search and Next; verify in browser cases. Fold, unfold, pins, Tidy with Undo and search shipped; Next moved to #222.
- [x] 2.4 Add status pulses with reduced-motion handling and the ⋯ menu settings (pulses, board surface, help). Pulses (working or selected only, reduced motion) and the ⋯ menu with Status pulses and Event trace shipped; surface override and help moved to #222.
- [x] 2.5 Verify input acknowledgement at maximum scale against the Town baseline. Moved to #222. Gesture and frame-loop unit tests plus real-input CDP runs at phone and desktop sizes cover correctness; a maximum-scale timing comparison with Town is not yet done.

## 3. Detail panel

Replaced by World's shared Inspector (owner review, 2026-10-18): Board selects the exact workspace or pane and the Inspector provides Terminal, Files, Changes and Agent History, docked or floating, on desktop and phone.

- [x] 3.1 Add the tab panel (status, per-pane questions and answers, Output, Files, Changes, History, open terminal and composer) over the existing agent history, file and git operations; verify exact-pane answers with two waiting panes in one tab and retirement rejection.
- [x] 3.2 Add the workspace panel (Tabs, combined Files and History, repository Changes, new tab, fold, tidy).
- [x] 3.3 Present the panel as a bottom sheet on phones with phone Back through the shared system Back module.

## 4. Notes and strings

- [x] 4.1 Add notes (create by double-click or double-tap, edit, colour, delete) and strings (drag from a card's handle, String to…, a pane chooser for multi-pane tabs, cut from the string or the panel).
- [x] 4.2 Send a note to a strung agent pane with `agent.prompt` over the qualified route, only on the user's Send and after revalidation (attached, current generation, agent present); verify the exact pane, each refusal and that nothing is sent otherwise.
- [x] 4.3 Start a new agent from a note: `tab.create`, `agent.start` in its root pane, a bounded wait for `interactive_ready` (as in `server/src/assistant/actions.ts`), then `agent.prompt` and the string; verify partial failure, the uncertain timeout and that nothing is retried.

## 5. Persistence and identity

- [x] 5.1 Add the bounded, revisioned board store in the service beside the connection profiles, with qualified read and patch RPCs and a change broadcast; verify bounds, atomic writes, conflict rejection and isolation between connection profiles.
- [x] 5.2 Anchor strings to workspace, tab and pane IDs with terminal-ID continuity witnesses and the attached, unresolved, unconfirmed and detached states; rewrite pane anchors from World move results; add the Needs a home tray and the per-host keep-or-detach prompt; verify with delayed-host recovery, offline host, World restart, Herdr restart, reused IDs with identical names, rename, close and external-move sequences.
- [x] 5.3 Record the behavioural verification decision for the store and anchors in `verification/coverage.json` (a Quint model or a justified direct alternative). Recorded as alternative evidence on Q43 in `verification/coverage.json`.

## 6. Delivery

- [x] 6.1 Update `docs/TUTORIAL.md`, `FEATURES.md`, the README view list and the knowledge map; add CHANGELOG entries.
- [x] 6.2 After Board ships, raise issue #216 upstream as a Herdr proposal for durable workspace, tab and pane annotations or a session identity, citing the display-only metadata limits and the restart prompt it would remove. Tracked in #216, to raise once Board is released.
