# Upstream provenance and local delta

Herdr World is an independent downstream product derived from
[`kcosr/herdr-web`](https://github.com/kcosr/herdr-web). The shared Git history
begins at the exact upstream commit below:

```text
67a4ace73fcd554af39586769dc86d4d9e82f09b
```

The MIT license and copyright notice are preserved in [`LICENSE`](LICENSE).
Git ancestry is preserved, `origin` points at `IvoryHeart/herdr-world`, and
`kcosr/herdr-web` is configured as the `upstream` remote. Herdr World does not
require a sibling Herdr Web checkout or a separately released foundation
package.
Reviewers can verify the relationship without trusting this document:

```bash
git merge-base --is-ancestor 67a4ace73fcd554af39586769dc86d4d9e82f09b HEAD
git remote -v
git diff --stat 67a4ace73fcd554af39586769dc86d4d9e82f09b...HEAD
```

## 2026-08-25 Herdr Web v0.5.0 reconciliation

The new `IvoryHeart/herdr-world` repository was cut from the working downstream
protocol-20 baseline `bbf0d8ef652e740824174091382667e2c2e0df60`. It was then
reconciled with:

- Herdr Web `v0.5.0`: `4718dade4b21d6b91119a3ee1cf4e88d5c36e344`
- Herdr Web `main`: `e67537b6bdd99fe489584252ba2f84ea070a3193`
- Herdr `v0.8.2`: `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`
- Herdr `master` observed during the audit:
  `d79fd746a96ddb5642939c9727baefce642d78e6`

The reconciliation was concern-based because both histories independently
changed the same generic Web files. It adopted the missing behavior and then
recorded the fetched Herdr Web head as a merge parent, so later upstream syncs
have a normal ancestry boundary rather than repeating this audit.

| Concern | Upstream source | Result in Herdr World |
| --- | --- | --- |
| Mobile static cursor | `d881f267`, `9c058ee1` / PR #60 | Adopted while retaining the transparent Office terminal renderer. |
| Wrapped mobile URL copy | `a4eb5285`, `e5a01194` / PR #61 | Adopted with the upstream renderer-independent normalization. |
| Negotiated gzip terminal output | `952c7f65`, `c41a1c5c`, `8e338e7a` / PR #59 | Adopted in the existing protocol-20 bridge and client. |
| Attention recency tiebreak | `9af4abdf` | Adopted while retaining qualified multi-host fallback ordering. |
| Workspace reorder, supervised development, IME, focus restoration, screen-reader text, favicon, and icon centering | Herdr Web v0.4.1-v0.4.3 | Already present in the downstream baseline; not duplicated. |
| Herdr v0.8.2 / terminal protocol 20 | `816f25a6`, `a1c4f5f9` | Already implemented and more completely verified by the downstream vendored compatibility slice. |
| Release bookkeeping and upstream contribution policy | v0.4.1-v0.5.0 release commits | Not copied as product behavior; Herdr World owns its releases and contribution policy. |

World-only Office rendering, observability, multi-host protections, assets, and
product documentation were retained. Historical audits below remain dated
records; their statements about what was current at the time are not the active
compatibility baseline.

## 2026-08-14 synchronization audit

The canonical Herdr source upstream is `herdrdev/herdr`. At the audit point,
its observed `master` commit was:

```text
d76657f2c7fc18dcce3b9af43842c8afaba1646b
```

The audited Herdr Web upstream head is
`98975226737821182f87a1eece8a080fffc4020e` (`9897522`), the PR #56 favicon
attribution follow-up (`Reference PR 56 and credit favicon contributor.`) on
`kcosr/herdr-web`. The Herdr source observation reported protocol 20 at that
point; it is a dated, non-normative observation and does not change this
repository's reviewed Herdr `v0.8.0` / terminal-protocol-19 compatibility
contract. This synchronization slice adopts only the compatible Herdr Web
favicon and square-icon alignment fixes.

The adopted upstream source commits and contributor records are:

- Favicon: `dfb6adda4b20072a01ef7b54585a51e3ea6107e7`, authored by Craig P.
  Motlin (@motlin) in [PR #56](https://github.com/kcosr/herdr-web/pull/56).
- Square-icon centering: `d0a2bc482890c8d3b0469eb0c042186c708783fc`, authored by
  Philippe SEGATORI (@tigitz) in [PR #55](https://github.com/kcosr/herdr-web/pull/55).
- PR #55 attribution follow-up: `f30e595b6cf15be4e72f758f759112e01164e923`.

## Untouched baseline result

The clean baseline was checked on 2026-08-01 before product edits with Node
22.16.0/npm 11.7.0 and Rust stable 1.97.1:

```text
npm ci
npm ci --prefix web
npm run check

vendor layout: pass
frontend lint: pass
frontend tests: 30 files, 241 tests passed
Herdr compatibility tests: 112 passed
bridge tests: 130 passed
frontend production build: pass
bridge debug build: pass
```

The first attempt documented two workstation-only prerequisites: the system
Rust 1.75 installation lacked `cargo-fmt`, and its Cargo could not read the
checked-in version-4 lockfiles. No tracked file changed. Supplying current
Rust stable plus `rustfmt` produced the clean result above.

## Categorized local delta

All commits after the pinned baseline belong to one of these reviewed groups:

1. application boundaries: app shell, core navigation, static internal surface
   registry, host registry, runtime client/cache, and terminal-session seams;
2. federation correctness: stable host profiles, qualified runtime identity,
   exact command/terminal routing, compatibility isolation, and stale-host
   control gating;
3. bridge contract and security: explicit bridge/Herdr version capabilities,
   bounded diagnostics, loopback defaults, and explicit non-loopback Host and
   Origin configuration;
4. verification: unit, bridge, multi-host, partial-failure, terminal-fanout,
   browser, responsive, accessibility, security, and independence fixtures;
5. World downstream integration: the optional Pixel Office projection, bounded
   observability contract/provider seam, Office settings, and browser lifecycle
   coverage;
6. operations and provenance: CI containment, trusted-access guidance,
   acceptance evidence, source/asset provenance, and this auditable delta
   record.

The World, Pixel Office, and observability work is downstream integration in
this fork. It is intentionally not represented as an upstream Herdr Web
requirement. The upstreamable units remain the generic contracts, bridge
capability/transport changes, and any independently reviewable compatibility
fixes; Office presentation, provider deployment assumptions, and assembled
World packaging remain downstream until their boundaries are accepted.

This repository does not add authentication, RBAC, SSH management, a public
plugin SDK, or a central fleet gateway.

## 2026-08-20 Spec 015 protocol-20 audit

This audit was fetched immediately before approving and implementing Spec 015
work unit 1. No upstream protocol-20 fix had landed, so this downstream branch
does not compete with an existing fix.

Exact fetched revisions:

| Source | Revision or state | Evidence |
| --- | --- | --- |
| Herdr stable release | `v0.8.2`, peeled commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`; tag object `34ba52cc6ff3b723e6fc0130485ec24582dbe205` | `git ls-remote git@github.com:herdrdev/herdr.git refs/tags/v0.8.2 refs/tags/v0.8.2^{}` |
| Herdr current `master` | `2c042bb2ce845ca4c7fbe03df3e7eb041abd0252` | `git ls-remote ... HEAD refs/heads/master` and clean checkout |
| Herdr current contribution policy | `CONTRIBUTING.md` blob `93e8b9c20a79e69b7009f12024530e3e11720c75`; `.github/APPROVED_CONTRIBUTORS` blob `81f714f54047f9e15c7f2cc2e75af1a718ed3b22` | Current Herdr checkout; unsolicited implementation contributions are restricted to maintainers/approved contributors, and IvoryHeart is not listed |
| Herdr Web current `main` | `cff6335683acc20cbb76c24b67d03f9e75dd78e6` | `git ls-remote git@github.com:kcosr/herdr-web.git HEAD refs/heads/main` |
| Herdr Web current contribution policy | `CONTRIBUTING.md` blob `0b8d5147a94d2282846700957b638421e3570aa5` | Current Web `main`; focused pull requests are welcome and larger work should be discussed in an issue |
| Herdr Web issue #65 | Open; updated `2026-08-20T03:06:52Z`, 0 comments, no linked development PR | `gh api repos/kcosr/herdr-web/issues/65` fetched 2026-08-20 |

The v0.8.2 release wire/API slice was compared with current Herdr `master`:
`git diff --stat 9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c..2c042bb2ce845ca4c7fbe03df3e7eb041abd0252 -- src/protocol/wire.rs src/api/schema.rs src/api/schema src/server/headless.rs`
was empty. The current release therefore remains the reviewed contract. The
vendored source is Apache-2.0 from Herdr v0.8.2; source paths, destination
hashes, license hash, local adaptations, and repeatable commands are recorded
in [`vendor/herdr-compat/VENDOR-MANIFEST.toml`](vendor/herdr-compat/VENDOR-MANIFEST.toml).

Issue #65 remains open and still describes the old protocol-19 incompatibility:
the current Web binary reports protocol 20 as incompatible and requests 19.
This work unit resolves that downstream compatibility gap. No upstream Herdr
PR or maintainer comment was opened or added.

### Web v0.4.3 replay adoption matrix

The following current Web work remains deliberately outside Spec 015 work unit
1. It is follow-up replay work for the separate Web v0.4.2/v0.4.3 behavior
slice, not a protocol bridge prerequisite:

| Concern | Current upstream evidence | Work-unit-1 disposition |
| --- | --- | --- |
| Dev-server workflow | merged PR #57, `4c2ef62` | Not applicable; active local setup is retained and protocol docs are updated |
| Terminal IME/composition replay | merged PR #58, `e13c83d` | Deferred follow-up; not adopted here |
| Dialog/menu focus behavior | merged PR #62, `346beee` | Deferred follow-up; not adopted here |
| Terminal accessibility replay | merged PR #64, `eb47f62` | Deferred follow-up; not adopted here |
| Static asset/cache policy | current Web `main` `cff6335683acc20cbb76c24b67d03f9e75dd78e6` | Not applicable; no protocol-20 bridge change required |

The downstream branch intentionally contains no Web v0.4.2/v0.4.3 dev, IME,
focus, accessibility, or replay implementation. Specs 004, 010, and 011,
generic extension registries, World-only work, and packaging extraction remain
outside this PR as required by Spec 015.

### Stock daemon evidence

The live check used the unmodified Herdr v0.8.2 checkout at
`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, built with the upstream-required
Zig `0.15.2` toolchain:

```bash
ZIG=/path/to/zig cargo build --release --bin herdr
HERDR_BIN=/path/to/herdr-v0.8.2/target/release/herdr \
  HERDR_WEB_BRIDGE_BIN="$PWD/bridge/target/debug/herdr-web-bridge" \
  HERDR_WEB_STATIC_DIR="$PWD/web/dist" \
  scripts/live-stock-v082.sh
```

The repeatable runner starts two disposable stock daemons with explicit socket
overrides, creates one workspace/pane in each, starts two isolated bridges, and
executes `scripts/live-bridge-smoke.mjs`. On 2026-08-20 it passed startup,
capabilities, snapshots, API command plus event, terminal attach/input/resize/
scroll, shared fan-out, detach/reattach, and independent multi-bridge routing.
The live output also confirmed that stock v0.8.2 keeps the browser's
`TerminalAttach` stream open when a pane emits BEL bytes. Stock Herdr forwards
the `TerminalBell` side effect only to a foreground full-app client, not to a
`TerminalAttach` client; exact bridge conversion to bounded BEL output is
therefore proven by the frozen protocol fixtures and focused bridge tests, while
the stock live limitation is retained for reviewer attention.

## 2026-08-20 Spec 015 work unit 2 Web v0.4.2/v0.4.3 audit

This audit records the concern-based replay of compatible Herdr Web behavior after
Spec 015 work unit 1. The downstream baseline was `origin/main` at
`565537b3a7452fb2ea8b72f7bb046e6c09eb3afa`. The fetched upstream revisions were:

- `upstream/main`: `cff6335683acc20cbb76c24b67d03f9e75dd78e6`
- `v0.4.3^{commit}`: `5ad48ed42507dd0b50c07183cabdec8b391c2512`
- upstream `CONTRIBUTING.md`: blob `0b8d5147a94d2282846700957b638421e3570aa5`

The upstream audit was rechecked before implementation. Issue #65,
[herdr-web-v0.4.3-linux-x86_64 not work for herdr 0.8.2](https://github.com/kcosr/herdr-web/issues/65),
was open with no comments. The open upstream PRs were #63, #61, #60, #59, and
#37; none was a protocol-20 compatibility PR. The exact recheck commands were:

```sh
git fetch origin main
git fetch upstream main --tags
git rev-parse origin/main
git rev-parse upstream/main
git rev-parse v0.4.3^{commit}
gh issue view 65 --repo kcosr/herdr-web --json number,state,title,comments,updatedAt,url
gh pr list --repo kcosr/herdr-web --state open --limit 20 \
  --json number,title,headRefName,baseRefName,url
git rev-parse upstream/main:CONTRIBUTING.md
```

### Adoption matrix

| Concern | Upstream source and attribution | Classification | Downstream result |
| --- | --- | --- | --- |
| Supervised development, readiness, shutdown, signals, and static-asset cache policy | PR #57 merge `4c2ef62aca1bd7320d026791602a0b36cedd247e`; implementation `09d386ab303f1babd4a06974f9de2c8c5d3159fd`; original contribution by Hopkins (`@LosEcher`), PR #51 | adopted | Replayed with loopback-safe defaults, namespaced child environment, readiness/error handling, multi-process cleanup, and deterministic cache tests. |
| Contribution guidance | PR #57 merge `4c2ef62aca1bd7320d026791602a0b36cedd247e`; `4bac49fb76a23edfb9c57fd6b1f7fabc75a25ade`; authored by Kevin (`kcosrdev@gmail.com`) | conflicted at the time | Assessed but not copied: Herdr World owns its contribution policy. The current Spec 004 records that downstream decision. |
| Terminal IME composition, cancellation, fallback preedit, and desktop focus | PR #58 merge `e13c83d429d1f51199ca0eee1810485acf47ad60`; `3f39d3be243ff6313e404db19852dbac8b18b21e`, `db88e34567a2c68fe8814777ddaac6fb2ef60e2e`, `052c638982449deec7f6fc08b2110ccf3c2328aa`, `3c7d0b93a3cd50044dbb55a5c66f3f1f09fbdf5c`; original contribution by Hopkins (`@LosEcher`), PR #51 | adopted | Replayed through the existing renderer, including preedit overlay, cancellation suppression, fallback handling, desktop focus, and mobile-input preservation. |
| Dialog/menu activation and focus restoration | PR #62 merge `346beeee614cb54da32f29e3a22c1e44d8133014`; `8af7cd62a56894dcaf89f58b1016a1654d158dda`, `276ca305bfab9c7a1e772d8110c26b060e308361`, `0870cd3efd518e822111b72d6ffa30e892567694`; original contribution by shuv (`@shuv1337`), PR #37 | adopted | Replayed with shared focus-return/trap helpers and downstream integration for Spaces, Office, notes, settings, launchers, and pane menus. |
| Optional terminal screen-reader text and settings | PR #64 merge `eb47f62d9df04847345f90b70ddb54a926d95c5f`; implementation `31d4070a2740766a53a788395aaa6cd93ab5c865`; attribution follow-up `253930760b0133aa43f6bd4206d45fc3edcbdf80`; original contribution by shuv (`@shuv1337`), PR #37 | adopted | Added a default-off, bounded visible-viewport mirror with persisted settings and per-runtime/World labels; visible scrolled-back rows are intentionally mirrored, while unbounded terminal history is not exposed. |

The replay used focused downstream commits rather than cherry-picking upstream
merge commits. It deliberately excludes the unrelated mobile chord composer,
wrapped-URL/cursor work, output compression, iOS, favicon, packaging, and other
release changes. It also leaves the protocol-20 contract, World security
boundaries, federation admission, and multi-bridge isolation unchanged.

The active compatibility-document scan is reproducible from the repository root
and returned no matches on 2026-08-20. Git pathspec exclusions keep the
historical records out of the active-document result:

```sh
git grep -n -E 'protocol[[:space:]-]*(16|17)|protocol (16|17)' -- '*.md' \
  ':(exclude)docs/evidence/**' \
  ':(exclude)CHANGELOG.md' \
  ':(exclude)UPSTREAM.md' \
  ':(exclude)docs/specs/013-upstream-synchronization-spec.md' \
  ':(exclude)docs/specs/013-upstream-synchronization-spec-summary.md' || true
```

Spec 015 work units 1 and 2 are implemented and recorded in the immutable
parent's [implementation summary](docs/specs/015-upstream-v043-protocol20-realignment-spec-summary.md).
The approved parent remains unchanged. Final review and merge are the remaining
repository workflow steps; they do not require editing the approved parent.
The v0.4.2/v0.4.3 replay does not rewrite Spec 013 or historical evidence.
