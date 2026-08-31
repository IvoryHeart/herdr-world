# Implementation summary — Herdr World automated release distribution

- **Parent spec:** [`017-herdr-world-automated-release-distribution-spec.md`](017-herdr-world-automated-release-distribution-spec.md)
- **Implemented at:** 2026-08-30
- **Implementation status:** Complete; first stable release remains pending

> This summary records the delivered release pipeline and its preview-channel
> validation. The approved parent specification remains the implementation
> contract; the first stable release is an operational milestone, not another
> implementation tranche.

## Delivery record

### 2026-08-28 — Automated multi-channel pipeline delivered

- **Implemented:** Added one protected, tag-triggered release workflow for
  GitHub Releases, npm, Homebrew, and the Herdr plugin. The workflow validates
  release provenance before publication credentials are available, serializes
  release tags through one queue, builds and live-smokes the three native
  archives once, and reuses the verified outputs for every distribution
  channel. Stable and RC identities, channel monotonicity, draft-first GitHub
  assembly, npm package selection, Homebrew Formula generation, content-aware
  retries, and same-version conflict rejection are covered by repository-owned
  tooling and tests.
- **Evidence:** [PR #29](https://github.com/IvoryHeart/herdr-world/pull/29)
  delivered the initial implementation with the complete repository check, 36
  release tests, 442 web tests, 281 Rust/bridge tests, native archive checks,
  npm pack/install smoke, and Formula generation validation.
- **Constraints / operational notes:** Repository-level GitHub release
  immutability remains disabled as approved. Homebrew uses the supported
  third-party tap and its scoped token. Linux ARM64, musl, Windows, signed
  Android, iOS, platform-split npm packages, and official Homebrew submission
  remain deferred.
- **Drift from approved spec:** None in the implementation.
- **Follow-up extension:** None.

### 2026-08-29 to 2026-08-30 — Protected publication rollout completed

- **Implemented:** Bootstrapped the public `@ivoryheart/herdr-world` npm
  package, enabled trusted publication, published later RCs through GitHub
  Actions OIDC with provenance, created and advanced the
  `IvoryHeart/homebrew-tap` RC Formula, and integrated the Herdr plugin's exact
  unpublished and post-publication lifecycle smoke. Release corrections made
  Formula validation, npm publish-time scanning, squash-merged provenance,
  plugin startup, and partial-publication retries deterministic and
  fail-closed.
- **Evidence:** The protected
  [`v0.1.0-rc.15` release run](https://github.com/IvoryHeart/herdr-world/actions/runs/33308114443)
  passed provenance and notice gates; native package and live smoke on Linux
  x86-64, macOS ARM64, and macOS x86-64; npm assembly and install tests on all
  three targets; Homebrew lifecycle tests on all three targets; Herdr plugin
  smoke on all three targets; and GitHub, npm, and Homebrew publication. The
  resulting [GitHub release](https://github.com/IvoryHeart/herdr-world/releases/tag/v0.1.0-rc.15)
  contains all three archives and checksum files.
- **Constraints / operational notes:** macOS Developer ID signing and
  notarization are deferred for `v0.1.0`; the public documentation and release
  checklist continue to identify those archives as unsigned. The stable npm
  and Homebrew channels will first be established by the forthcoming
  `v0.1.0` release. No release was cut for this documentation update.
- **Drift from approved spec:** The one-time npm bootstrap left the npm
  `latest` pointer at `0.1.0-rc.5` while automated RC publications correctly
  advanced only `next`. The owner has accepted this temporary external state
  until the imminent `v0.1.0` stable release advances `latest`; no later RC
  publication moved it.
- **Follow-up extension:** None. Enabling GitHub release immutability or adding
  another signed/platform publisher remains a separately evaluated deferred
  decision.

### 2026-08-31 — Reviewed release preparation boundary

- **Implemented:** Split the operator command into branch-only `prepare` and post-merge `tag`
  phases. Preparation now leaves one complete release diff—including the next empty Unreleased
  section and exact Herdr Web baseline correlation—for independent pull-request review. The World
  changelog no longer duplicates inherited Herdr Web release history. Tagging accepts only the exact
  reviewed squash merge on current `origin/main`, requires a successful distribution preflight for
  that commit, and pushes only the immutable release tag. A same-named tag inherited from Herdr Web
  is rejected locally and handled by using an origin-only release checkout rather than moving an
  upstream identity.
- **Constraints / operational notes:** The protected tag remains the publication trigger and
  authorization boundary. The first stable `v0.1.0` release remains pending; this workflow change
  does not cut it.
- **Drift from approved spec:** The operator command is now explicitly two-phase so repository
  changes follow the project-wide PR-review rule; artifact and publication semantics are unchanged.
- **Follow-up extension:** None.
