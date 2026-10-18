## 1. Model and placement

- [ ] 1.1 Implement the board model as a pure projection of World's bounded topology (hosts, workspaces, tabs, status) plus board items; verify completeness against the maximum-scale fixture.
- [ ] 1.2 Implement free-space placement, offsets and tidy (selection or whole board, with undo) as pure functions; verify non-overlap, stability under topology changes and zoom independence in unit tests.
- [ ] 1.3 Implement the short-lived physics (springs to anchor plus offset, overlap resolution, throw with friction, cooling to rest); verify it reaches rest within the time bound and writes offsets.

## 2. Board view

- [ ] 2.1 Add Board as a World view next to Graph (route, view switcher, phone navigation) with DOM cards, the SVG string layer, host zones, pan, wheel and pinch zoom, zoom controls and fit.
- [ ] 2.2 Add semantic zoom (overview with workspace status squares; tabs return when zoomed in) with hysteresis; verify at desktop and 390 px browser sizes.
- [ ] 2.3 Add fold and unfold into free space, pinning, tidy with undo, search and Next; verify in browser cases.
- [ ] 2.4 Add status pulses with reduced-motion handling and the ⋯ menu settings (pulses, board surface, help).
- [ ] 2.5 Verify input acknowledgement at maximum scale against the Town baseline.

## 3. Detail panel

- [ ] 3.1 Add the tab panel (status, answers, Output, Files, Changes, History, open terminal and composer) over the existing agent history, file and git operations; verify exact-pane answers and retirement rejection.
- [ ] 3.2 Add the workspace panel (Tabs, combined Files and History, repository Changes, new tab, fold, tidy).
- [ ] 3.3 Present the panel as a bottom sheet on phones with phone Back through the shared system Back module.

## 4. Notes and strings

- [ ] 4.1 Add notes (create by double-click or double-tap, edit, colour, delete) and strings (drag from a card's handle, String to…, cut from the string or the panel).
- [ ] 4.2 Send a note to a strung agent with `agent.prompt` over the qualified route, only on the user's Send; verify the exact pane, generation rejection and that nothing is sent otherwise.
- [ ] 4.3 Start a new agent from a note: `tab.create` in the chosen workspace, `agent.start` in its root pane, `agent.prompt` with the note, then string the note to it; verify partial-failure reporting.

## 5. Persistence and identity

- [ ] 5.1 Add the bounded, revisioned board store in the service beside the connection profiles, with qualified read and patch RPCs and a change broadcast; verify bounds, atomic writes, conflict rejection and isolation between connection profiles.
- [ ] 5.2 Anchor items to workspace, tab and pane IDs with fingerprints; rewrite pane anchors from World move results; detach mismatched or missing anchors into a "Needs a home" tray with re-attach and discard; verify with restart, closed-workspace, reused-ID and external-move sequences.
- [ ] 5.3 Record the behavioural verification decision for the store and anchors in `verification/coverage.json` (a Quint model or a justified direct alternative).

## 6. Delivery

- [ ] 6.1 Update `docs/TUTORIAL.md`, `FEATURES.md`, the README view list and the knowledge map; add CHANGELOG entries.
- [ ] 6.2 Optional, with owner approval: propose durable workspace, tab and pane annotations to Herdr upstream, citing the display-only metadata limits.
