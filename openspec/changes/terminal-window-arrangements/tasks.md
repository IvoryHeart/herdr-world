## 1. Make Herdr tab presentation reusable

- [ ] 1.1 Add focused regressions for sibling-pane selection, one Inspector per qualified tab, late resource replies, split/close reconciliation and failure on retired host or tab ancestry.
- [ ] 1.2 Separate stable Inspector window identity from selected pane context, and route Office, Tree, Graph and navigator selection of sibling panes to the existing tab window.
- [ ] 1.3 Extract the Spaces split-pane renderer for a specified tab and use it in World Inspector Terminal views; observe open tab layouts through bounded, lease-fenced `pane.layout` reads and preserve one attachment per qualified pane during Spaces/World handoffs.
- [ ] 1.4 Verify split, zoom, resize, pane close, background tab changes, focus/input, and layout reply races with focused and browser tests.

## 2. Arrange visible Inspector windows

- [ ] 2.1 Implement and test a pure geometry resolver for Cascade, Columns, Rows and Grid with counts two through six, stage bounds, minimum dimensions, deterministic focus order and unavailable reasons.
- [ ] 2.2 Add one shell-level arrangement action and restore snapshot for the currently visible, qualified Inspector instances.
- [ ] 2.3 Include docked and Tree inline Inspectors through temporary free geometry and reversible portal transfer.
- [ ] 2.4 Add one accessible layout menu with visual choices to the shared tab bar. Keep Spaces and compact presentations honest when fewer than two windows are actionable.
- [ ] 2.5 Verify drag/resize/dock after arranging, Restore, new and closed windows, stage/viewport changes, connectors, focus and terminal refit without Herdr mutation.

## 3. Accept, document and deliver

- [ ] 3.1 Run desktop browser scenarios across Office, Tree, Graph and Spaces for two through six windows, split panes, docked/inline return, selected-host change and compact-to-desktop return.
- [ ] 3.2 Update `FEATURES.md`, the affected World surfaces current spec, the knowledge map if ownership paths move, and the appropriate `CHANGELOG.md` Unreleased entry; preserve unrelated edits.
- [ ] 3.3 Run focused checks during development and `bun run check` on the final candidate, inspect diff/history for generated output and sensitive data, obtain independent review, and record verification and actual agent usage in the PR template before a ready PR.
- [ ] 3.4 Compare recorded agent roles, token and time boundaries, checks and review repairs with PR #109's process baseline; record any supported delivery-workflow adjustment without adding a new gate.
