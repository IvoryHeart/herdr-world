# Tree Operations Console Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with sequential writers, task review and final review. This OpenSpec document is the only implementation plan.

**Goal:** Deliver the approved common sidebar and compact Tree Operations Console in a ready PR.

**Architecture:** Adopt the actual sidebar branch into the shared shell. Refine Tree's presentation over the existing projection and action callbacks; retain shared terminal ownership.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright; existing dependencies only.

**Spec:** `openspec/changes/tree-operations-console/design.md` and `specs/world-surfaces/spec.md`; existing `openspec/specs/world-surfaces/spec.md` remains binding.

## Global Constraints

- The hierarchy remains host → space → agent/terminal; no inferred project, repository, task, artifact or service parents.
- Preserve search with ancestors, independent collapse, selection without activation, guarded current-generation actions, pan/zoom/Fit, validated Tree preferences and canonical `/?theme=tree` history.
- Preserve PR #79 mobile open/back focus, host-health visibility and Add Host behavior.
- All published evidence uses synthetic fixtures. No production dependency or bridge protocol changes.
- Use Superpowers/native Codex; do not start Ralph. Only one implementation writer at a time. Stop at a ready PR; do not merge.

## 1. Shared navigation

### Task 1: Adopt the common sidebar with Tree

**Files:** Integrate `origin/agent/sidebar-menu-design` (PR #79 at `3ae76e810d7d8e1bd3772d2da9880dd3048e9c07`) into the current branch. Reconcile `web/src/App.tsx`, `SidebarToolbar.tsx`, `WorldThemeStage.tsx`, shared focus/boundary files, `styles.css`, and affected tests. Preserve existing Tree model/context/guards. Update `tests/e2e/world-tree.spec.ts`, `sidebar-toolbar.spec.ts`, `sidebarControls.ts` and `web/src/SidebarToolbar.test.tsx` for the shared navigation.

**Interfaces:** `ToolbarPrimaryView` must include `"tree"`; View values map to the existing canonical navigation helpers. `WorldThemeContext` and Tree callbacks retain their current signatures.

- [x] 1.1 Add behavioral coverage for all four View options, Tree URL/history, current-view reopen and mobile Back focus. Verify a focused test fails against the pre-integration implementation because the common View/Tree behavior is absent.

```ts
await page.goto('/?theme=tree');
await expect(page.getByRole('combobox', { name: 'View', exact: true })).toHaveValue('tree');
await expect(page.getByRole('combobox', { name: 'View', exact: true }).locator('option')).toHaveCount(4);
await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('graph');
await page.goBack();
await expect(page).toHaveURL(/\/?theme=tree$/);
```

- [x] 1.2 Merge the pinned sibling branch, resolve conflicts deliberately and include Tree in its type, picker option, canonical handler and mobile accessible label. Preserve PR #79's host setup and focus fixes. Verify `git diff --check`, focused sidebar/Tree Vitest tests and `npx playwright test tests/e2e/sidebar-toolbar.spec.ts tests/e2e/world-tree.spec.ts` after `npm run build:web`.

```tsx
export type ToolbarPrimaryView = 'spaces' | 'office' | 'tree' | 'graph';
// Keep the existing picker; add its Tree entry and route through the shared handler.
<option value="tree">Tree</option>
```

- [x] 1.3 Run `npm run check`, self-review the privacy-safe diff, commit the adoption and report exact tests/results for task-scoped independent review. Address its findings before Task 2.

## 2. Tree presentation

### Task 2: Render the compact Operations Console

**Files:** `web/src/world/tree/TreeTheme.tsx`, a focused Tree stylesheet imported by that component if separating the existing Tree style block improves clarity, `web/src/styles.css`, `TreeTheme.test.tsx`, and `tests/e2e/world-tree.spec.ts`. Update the current World surface spec, README/knowledge map if needed and Unreleased changelog with the observable result. Save synthetic desktop and phone captures under `docs/evidence/tree-operations-console/`.

**Interfaces:** Consume unchanged `WorldThemeContext`, `WorldGraphNode`, `WorldGraphHost`, `WorldGraphSpace`; parent selection and activation callbacks stay authoritative. Existing `.tree-map` transform and viewport geometry remain compatible with camera checks. Task 1 provides the common sidebar and four-view picker.

- [x] 2.1 Add focused failing behavioral coverage for empty/collapsed connector presentation and persistent operational overview/selection. Keep existing tests for stale actions, search/collapse and camera. Run `npm run test:web -- TreeTheme` and record expected failures. Pure styling is verified through rendered inspection rather than implementation-mirroring tests.

```tsx
// Only branches that actually render children advertise a child connector.
const expandedWithChildren = !collapsed && spaces.length > 0;
// Summary and inspector consume projected nodes and coverage; never invented metrics.
const selectedNode = projection.nodes.find(node => node.selectionKey === context.selectedKey) ?? null;
```

- [x] 2.2 Implement the dark compact dashboard defined in design.md: clear type/status cards, orthogonal attached connectors, persistent overview/inspector, compact semantic navigation and suitable desktop/phone spacing. Keep search, selection and guarded action handlers intact. Verify focused Vitest, lint and build.

- [x] 2.3 Extend synthetic browser acceptance to unequal branches, collapsed/empty topology, selection/actions, wide desktop and phone/reduced-motion layouts; verify with `npx playwright test tests/e2e/world-tree.spec.ts`. Capture the rendered result and inspect it against the original reference, correcting any concrete mismatch before delivery.

- [ ] 2.4 Synchronize implemented World requirements and changelog, run `npm run check` and `npm run spec:check`, self-review the diff, commit and obtain task-scoped review. Address findings using the same implementer thread.

## 3. Integration acceptance and delivery

- [ ] 3.1 Controller obtains final independent whole-change source and visual review, resolves findings, and records the result once in a sanitized delivery note.
- [ ] 3.2 Controller runs `npm run check:acceptance` and `npm run spec:check` on the final candidate, records exact results and any opt-in skips, and checks published screenshots contain only synthetic data.
- [ ] 3.3 Controller opens a ready PR against PR #81's actual branch, identifies the explicitly adopted PR #79 dependency, adds the PR number to the changelog, verifies remote status, and stops before merge. Record Superpowers/native Codex execution without claiming Ralph acceptance or comparative cost savings.
