# Implementation summary — Herdr v0.8.2 / protocol-20 and Web v0.4.2/v0.4.3 replay

- **Parent spec:** [`015-upstream-v043-protocol20-realignment-spec.md`](015-upstream-v043-protocol20-realignment-spec.md)
- **Implemented at:** 2026-08-20
- **Implementation status:** Complete

> The approved parent specification remains immutable. This summary records
> the delivered work units, provenance, validation evidence, and explicit
> limitations.

## Delivered implementation

### Work unit 1 — Herdr v0.8.2 and terminal protocol 20

Delivered in downstream commit
`565537b3a7452fb2ea8b72f7bb046e6c09eb3afa`.

- Refreshed only the bridge-required `vendor/herdr-compat` source from the
  unmodified Herdr v0.8.2 source commit
  `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, preserving Apache-2.0
  provenance and recording source/destination hashes and local adaptations.
- Implemented the complete protocol-20 wire shape: discriminant-sensitive
  enum ordering, direct-graphics and pixel-input messages,
  `MouseCapture.sgr_pixels`, terminal-bell messages, frozen fixtures, and
  exhaustive bridge handling.
- Admitted Herdr v0.8.2-or-newer only for exact protocol 20. Protocol 19, 21,
  missing, malformed, and otherwise invalid versions are rejected before
  terminal attach with bounded diagnostics.
- Kept browser sessions in `ClientLaunchMode::TerminalAttach` with zero pixel
  dimensions; direct-graphics-only messages remain safely ignored without
  filesystem access, payload logging, browser forwarding, or graphics replies.
- Routed `TerminalBell` through the binary output/coalescing path with a
  zero-safe `min(count, 16)` BEL bound and ordering/coalescing coverage.

Live validation used two unmodified stock Herdr v0.8.2 daemons from the exact
source commit above. Startup, capabilities, snapshots, commands/events,
terminal attach/input/resize/scroll, detach/reattach, shared fan-out, multiple
terminals, and independent multi-bridge routing passed. Stock Herdr exposes a
`TerminalBell` side effect to a foreground full-app client but does not send
that event through a direct `TerminalAttach` stream; the downstream bounded
bell conversion is covered by frozen protocol and bridge tests, and this stock
limitation remains explicit rather than being hidden by a mock-only claim.

### Work unit 2 — focused Web v0.4.2/v0.4.3 behavior replay

Delivered as focused concern commits on top of the protocol-20 change. The audited upstream revisions
were Herdr Web `main`
`cff6335683acc20cbb76c24b67d03f9e75dd78e6`, release `v0.4.3^{commit}`
`5ad48ed42507dd0b50c07183cabdec8b391c2512`, and upstream
`CONTRIBUTING.md` blob `0b8d5147a94d2282846700957b638421e3570aa5`.

| Concern | Classification | Source and attribution | Downstream result |
| --- | --- | --- | --- |
| Supervised development, readiness/shutdown, signals, static-asset cache policy | adopted | PR #57 merge `4c2ef62aca1bd7320d026791602a0b36cedd247e`; implementation `09d386ab303f1babd4a06974f9de2c8c5d3159fd`; Hopkins (`@LosEcher`), PR #51 | Loopback-safe supervised `npm run dev`, bounded readiness/error handling, child cleanup, namespaced environment, immutable hashed assets, revalidated entrypoints, and route-level `/`, `/world`, and `/world/` cache regression coverage. |
| Contribution guidance | conflicted | PR #57 commit `4bac49fb76a23edfb9c57fd6b1f7fabc75a25ade`; Kevin (`kcosrdev@gmail.com`) | Assessed but not copied into downstream governance because Spec 004 World ownership and contribution-lane decisions remain unresolved. |
| Terminal IME composition, cancellation, fallback preedit, desktop focus | adopted | PR #58 merge `e13c83d429d1f51199ca0eee1810485acf47ad60`; commits `3f39d3be243ff6313e404db19852dbac8b18b21e`, `db88e34567a2c68fe8814777ddaac6fb2ef60e2e`, `052c638982449deec7f6fc08b2110ccf3c2328aa`, `3c7d0b93a3cd50044dbb55a5c66f3f1f09fbdf5c`; Hopkins (`@LosEcher`), PR #51 | Reconciled with the existing renderer. Preedit remains local, cancellation is not replayed, fallback input is handled, desktop focus is retained, and mobile input remains intact. |
| Dialog/menu activation and focus restoration | adopted | PR #62 merge `346beeee614cb54da32f29e3a22c1e44d8133014`; commits `8af7cd62a56894dcaf89f58b1016a1654d158dda`, `276ca305bfab9c7a1e772d8110c26b060e308361`, `0870cd3efd518e822111b72d6ffa30e892567694`; shuv (`@shuv1337`), PR #37 | Shared focus-return/trap behavior is integrated across Spaces, Office, notes, settings, launchers, and pane menus. |
| Optional terminal screen-reader text and settings | adopted | PR #64 merge `eb47f62d9df04847345f90b70ddb54a926d95c5f`; implementation `31d4070a2740766a53a788395aaa6cd93ab5c865`; attribution follow-up `253930760b0133aa43f6bd4206d45fc3edcbdf80`; shuv (`@shuv1337`), PR #37 | Default-off, bounded/debounced plain-text mirroring is persisted and scoped per runtime/World. Visible scrolled-back rows are intentionally mirrored; unbounded terminal history and hidden cells are not exposed. |

The downstream attach-focus guard is an integration regression fix: a
terminal connection cannot steal focus from a control that wins focus while
the WebSocket attach is pending. Its deterministic regression test covers both
the changed and unchanged attach-time focus states.

## Acceptance evidence

- `HERDR_SRC=/tmp/herdr-upstream-v082 scripts/check-vendor.sh` — passed; all
  23 manifest entries, including adapted entries, had source and destination
  provenance verified.
- `CI=1 npm run check:acceptance` — passed locally. The run included root
  checks, 5/5 supervised-development tests, 411 web tests, 119 vendored
  compatibility tests including 3 protocol fixtures, 159 bridge tests, 44
  browser tests with 2 documented skips, security audit, and independence
  audit.
- Focused suites passed: attach-focus regression 2/2, IME and IME-focus 18/18,
  overlay focus 8/8, screen-reader text 11/11, and bridge web tests 27/27.
- `git diff --check origin/main...HEAD` — passed after removing the ten
  terminal blank-line errors reported during review.
- Active compatibility scan — no matches outside the explicitly historical
  records. The exact command is:

  ```sh
  git grep -n -E 'protocol[[:space:]-]*(16|17)|protocol (16|17)' -- '*.md' \
    ':(exclude)docs/evidence/**' \
    ':(exclude)CHANGELOG.md' \
    ':(exclude)UPSTREAM.md' \
    ':(exclude)docs/specs/013-upstream-synchronization-spec.md' \
    ':(exclude)docs/specs/013-upstream-synchronization-spec-summary.md' || true
  ```

- GitHub Actions run `32422208681`
  passed all five CI jobs on final review-fix head
  `5f63030191524d8d8f24692b7789d1318bc45fd4`.

## Constraints and remaining limitations

- The parent spec is not rewritten or marked Implemented by this record; its
  approved contract remains the source of truth.
- Web v0.4.2/v0.4.3 replay is limited to the four audited concerns. Unrelated
  mobile, URL/cursor, compression, iOS, favicon, packaging, release, and
  upstream protocol changes remain excluded.
- Specs 004, 010, and 011, generic extension registries, plugin SDK work,
  provider abstractions, surface composition, Office redesign, and packaging
  extraction remain excluded.
- No upstream pull request or maintainer outreach was opened.
- The security audit retains the three previously allowed dependency
  advisories (bincode unmaintained; anyhow and lru advisories); no new
  vulnerability was introduced.

## Historical-record preservation

Spec 013 and its summary, `docs/evidence/**`, historical `CHANGELOG.md`
entries, and historical `UPSTREAM.md` audit sections remain unchanged. This
summary is the final delivery record for Spec 015 work units 1 and 2 while the
approved parent spec remains immutable.
