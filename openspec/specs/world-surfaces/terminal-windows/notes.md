# Terminal Windows notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Tab-bar arrangements, shell Actions, optional shortcuts and window headers share window operations.
- Single/Cascade/Columns/Rows/Grid/Restore, maximize/resize and Close/Open all have distinct scope.
- Phones show one active window with Back/Tabs/overflow while keeping desktop geometry.
- TUI/core keep the same qualified presentation ownership; native split/layout support differs by runtime.

**Code:**

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
