# Implementation summary — Office productivity UX

- **Parent spec:** [`008-office-productivity-ux-spec.md`](008-office-productivity-ux-spec.md)
- **Implemented at:** 2026-08-11
- **Implementation status:** Complete

> The selected UX slice is delivered on the `codex/office-productivity-ux`
> branch. The summary records the intentionally bounded downstream behaviour.

### 2026-08-11 — Delivered implementation

- **Implemented:** Office terminal resize scheduling now uses animation-frame
  refits in [`TerminalView.tsx`](../../web/src/TerminalView.tsx). Browser-local
  Office view preferences in [`worldViewPrefs.ts`](../../web/src/world/worldViewPrefs.ts)
  retain bounded conversation geometry, order, and scroll position without
  terminal content. Office geometry now tightens the CEO block and derives
  room widths and desk/standing columns from room contents. Optional
  `task_summary` metadata flows through runtime snapshots and activity updates
  into bounded selected-agent callouts. Bridge Settings now has direct-federation
  Enable all / Disable all controls for saved profiles.
- **Evidence:** `npm run lint` passed; `npm run build` passed; `npm test`
  passed with 50 test files and 337 tests. The targeted bridge, activity,
  projection, selection, geometry, and view-preference tests passed with 47
  tests. The focused World Playwright regression for Office callouts and
  room-targeted seat creation passed. The complete 25-test World file was
  separately attempted, but its first worker stalled for more than two
  minutes without producing a result; only that test process and fixture
  server were terminated. This remains a runner follow-up, not a browser
  assertion failure.
- **Constraints / operational notes:** View state is per browser profile and
  currently unnamed; it is not cross-device or cross-browser synchronization.
  A bridge that does not emit `task_summary` remains fully compatible. The
  direct-federation controls do not add authentication, host discovery, SSH,
  or a central gateway. Existing renderer-level Office resize work retains its
  own 80 ms scene-build guard; this slice removes the extra terminal-canvas
  trailing debounce that caused the most visible inner-area blink.
- **Drift from approved spec:** The selected SUG-004 work is a downstream UX
  seam only, not the full authenticated coordinator described by the
  suggestion. SUG-007 is the lightweight persistence slice, not named presets.
  SUG-023 carries and presents the optional field but does not add a native
  Herdr harness producer, freshness policy, or upstream protocol contract.
- **Follow-up extension:** None required for this slice. Future native summary
  metadata and authenticated federation require their own reviewed extension
  or upstream specification.

### 2026-08-30 — Task-summary producer extension

- **Implemented:** The packaged `herdr-world task-summary` command now reports
  or clears the existing `task_summary` pane token without starting the web
  bridge. Reports are bound to the pane's active agent session, normalized,
  bounded to 160 Unicode characters, filtered for obvious credential-shaped
  values, and expired by Herdr after a 15-minute default or caller-selected
  bounded TTL. The bridge maps the token into snapshots and treats
  `pane.updated` as structural so reports, clears, and expiry refresh the
  browser.
- **Evidence:** Rust unit coverage exercises command validation,
  normalization, redaction, token mapping, snapshot serialization, and the
  structural subscription. Launcher tests prove the command bypasses guided
  setup. A live Herdr pane accepted, exposed, and cleared a report from the
  built debug bridge.
- **Contract change:** This supersedes the original producer/TTL deferral while
  preserving the existing protocol boundary: Herdr `v0.8.2` already supplies
  the metadata token, session-binding, expiry, and update-event primitives, so
  no new upstream schema or browser route was needed.
