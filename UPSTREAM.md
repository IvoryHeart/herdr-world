# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate: `c07db60b06b1b23a34ed143d47011a6b8330379a` (v0.7.9, synchronized/replayed
  from the v0.7.9 source before the World rebrand and visual projection), plus
  selected source fixes derived from the exact v0.7.10 commits below. This is
  not a complete v0.7.10 synchronization.
- Herdr compatibility: Herdr 0.9.0, terminal protocol 22

## Selective Roamgate review, 25 September 2026

Compared the pinned v0.7.9 source with the v0.7.10 tag at
`e4d28669c9f5cceaed6a0329705b00be3734f68b` and upstream main at
`84d0955d6eb221a20114fb1788a81579f7c472e1`. The table records every commit
in that range. **Applicable** means its source fix was adapted into World;
**defer** retains an explicit separate decision or compatibility prerequisite.

| Roamgate commit | Disposition in World |
| --- | --- |
| [`c94ceae`](https://github.com/powerfooI/roamgate/commit/c94ceae92f54e1c1ef2b1534b31cce5fc9690ecb) | **Applicable:** derive default-branch discovery, immutable commit fetch, worktree creation and auto-sync instead of hard-coded `origin/main`; preserve connection routing. |
| [`3520719`](https://github.com/powerfooI/roamgate/commit/35207197a6a28b511108e93e3680e9e448520d8a) | **Defer:** pane switcher identifier placement is visual polish; upstream precommit simplification does not replace World's delivery checks. |
| [`985f7bf`](https://github.com/powerfooI/roamgate/commit/985f7bf57c58861bd110440c94f9fb4399004e95) | **Defer:** Oxlint and TypeScript 7 are a separate toolchain migration; preserve the current lint and typecheck contract. |
| [`3445831`](https://github.com/powerfooI/roamgate/commit/344583127b2c89fbb2260dcf2ac981178616c49e) | **Defer:** a session-modal plugin pane needs connection-qualified popup ownership, lease retirement and Inspector/terminal focus behavior in World before source replay. |
| [`c038bc5`](https://github.com/powerfooI/roamgate/commit/c038bc5197ca23068ad9fc22bd2e8bb231300e3d) | **Defer:** the Pierre cache-key change follows the upstream diff-renderer dependency update; World has not made that dependency migration. |
| [`d64fe1a`](https://github.com/powerfooI/roamgate/commit/d64fe1af16ae2c4a4da3edacaa2961442f9a47f0) | **Defer:** Vite/React-plugin upgrade is a separate dependency update, not needed by the selected source fixes. |
| [`f7d6080`](https://github.com/powerfooI/roamgate/commit/f7d608069b1e3064b403e3cc8a9988ff63b36f4e) | **Applicable:** derive terminal HTTP-link probing fix for endpoint repaints. |
| [`cfa2d33`](https://github.com/powerfooI/roamgate/commit/cfa2d330dcf2170c1af544220da24e9261ce6d65) | **Applicable:** derive Web Push workspace/tab label lookup, with current-generation connection labels. |
| [`a7bc902`](https://github.com/powerfooI/roamgate/commit/a7bc90227d4363c0deac041372198ea6e072492d) | **Irrelevant to World:** removal of Roamgate browser tests and infrastructure conflicts with World's retained browser checks. |
| [`4053630`](https://github.com/powerfooI/roamgate/commit/405363022d1dcbbbce3877174ee3f9d53b16ea21) | **Applicable:** derive Ctrl+Enter terminal forwarding and shortcut migration. |
| [`54d8697`](https://github.com/powerfooI/roamgate/commit/54d86979a4f48176702bbdf7522f24899e2a3e0b) | **Applicable:** derive bounded Last step capture with private Git-object quarantine; use World-specific storage name and recovery guidance. |
| [`e4d2866`](https://github.com/powerfooI/roamgate/commit/e4d28669c9f5cceaed6a0329705b00be3734f68b) | **Irrelevant to World:** Roamgate version and release manifest are not World release identities. |
| [`98d0434`](https://github.com/powerfooI/roamgate/commit/98d0434db3ce2e63d0f2040152ef622f12fe9218) | **Defer:** Zen-mode top-edge layout is a separate visual choice for World's shared shell. |
| [`35d86b8`](https://github.com/powerfooI/roamgate/commit/35d86b82875904fd01a5fb90dd817d0a7240ffe0) | **Defer:** semantic notification authority and fallback change Web Push behavior across managed hosts; define protocol support and connection ownership first. |
| [`bd15749`](https://github.com/powerfooI/roamgate/commit/bd15749803f20e4777383e77196cd30e616371be) | **Defer:** independent terminal font size is a separate preference and migration decision for the shared World shell. |
| [`84d0955`](https://github.com/powerfooI/roamgate/commit/84d0955d6eb221a20114fb1788a81579f7c472e1) | **Defer:** dragging file paths into terminals creates a new input path that must be qualified and lease-checked for the target host and pane. |

Git history is the detailed source record. Future Roamgate refreshes are explicit merge
or replay changes against a pinned commit; World does not depend on a separately installed
Roamgate process, data directory, service, or private API.

Use these terms consistently:

- **Derived from** describes copied or synchronized Roamgate application source.
- **Compatible with** describes the external Herdr runtime and protocol.
- **Depends on** is reserved for an independently installed package or runtime.

Each World release records the exact Roamgate synchronization point. Required MIT
attribution is retained in [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
