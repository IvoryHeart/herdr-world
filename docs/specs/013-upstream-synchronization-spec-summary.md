# Implementation summary — Upstream synchronization and compatibility boundary

- **Parent spec:** [`013-upstream-synchronization-spec.md`](013-upstream-synchronization-spec.md)
- **Implemented at:** 2026-08-14
- **Implementation status:** Complete

> This summary records the delivered synchronization slice. The approved
> parent specification remains immutable.

### 2026-08-14 — Delivered implementation

- **Implemented:**
  - Refreshed and audited the configured Herdr Web remotes; the audited
    upstream head is `98975226737821182f87a1eece8a080fffc4020e` (`9897522`),
    the PR #56 favicon attribution follow-up on `kcosr/herdr-web`.
  - Audited canonical `herdrdev/herdr` `master` at
    `d76657f2c7fc18dcce3b9af43842c8afaba1646b`; its protocol-20 state remains a
    point-in-time, non-normative observation.
  - Added the existing `/herdr-logo.svg` as the browser favicon in
    [`web/index.html`](../../web/index.html).
  - Applied the current-structure equivalent of the Herdr Web square-icon fix:
    reset default button padding on `.icon-btn`, `.tabbar-add`,
    `.terminal-upload-fab`, and `.sec-add`; removed the compensating filter
    classes and transform in [`web/src/App.tsx`](../../web/src/App.tsx) and
    [`web/src/styles.css`](../../web/src/styles.css).
  - Updated [`CHANGELOG.md`](../../CHANGELOG.md) and [`UPSTREAM.md`](../../UPSTREAM.md)
    with the delivered behavior and upstream provenance.
  - Kept the Herdr `v0.8.0` / terminal-protocol-19 compatibility vendor and
    bridge admission contract unchanged.
- **Evidence:**
  - `npm run vendor:check` — passed.
  - `npm run lint:web` — passed.
  - `npm run test:web` — 52 files, 369 tests passed.
  - `npm run build:web` — passed.
  - `npm run check` — passed, including Rust formatting, 114 compatibility
    tests, 148 bridge tests, and bridge/web production builds.
  - `git diff --check` — passed.
  - Direct remote checks confirmed `herdrdev/herdr` `master` at `d76657f` and
    `kcosr/herdr-web` `main` at
    `98975226737821182f87a1eece8a080fffc4020e` (`9897522`).
- **Constraints / operational notes:** The bridge still requires Herdr
  `v0.8.0` or newer with terminal protocol 19. The full Herdr source tree was
  not vendored, and protocol-20 support was not attempted. The production
  build retains the existing chunk-size advisory warning; it does not fail the
  build. Pre-existing user-owned evidence image edits and the untracked
  repository analysis document were preserved.
- **Drift from approved spec:** None. The upstream patches were adapted to the
  current fork structure because their original patch contexts no longer
  matched, while the approved behavior and compatibility boundary were
  preserved.
- **Follow-up extension:** None. A future protocol migration would require a
  separately approved migration specification as stated by the parent spec.

## Delivery record

The bounded synchronization implementation is complete and validated. The
implementation commit is `6b7a0b1`, followed by delivery-record commit
`8509663`.
