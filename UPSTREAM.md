# Upstreams

Herdr World is derived from
[`kcosr/herdr-web`](https://github.com/kcosr/herdr-web) and runs against
[`herdrdev/herdr`](https://github.com/herdrdev/herdr).

The Git remotes are:

```text
origin    git@github.com:IvoryHeart/herdr-world.git
upstream  git@github.com:kcosr/herdr-web.git
```

Current synchronization points:

- Herdr Web: `4384c884da418ea3f3fb75954da5347b2e12f063`
  (`v0.5.0` plus the JetBrains Mono Nerd Font fallback merged in upstream PR #74)
- Herdr compatibility: Herdr `v0.8.2`, commit
  `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, terminal protocol `20`

The 2026-08-30 Herdr audit also reviewed `master` at
`4a3b04f59ba3b7d8a15cea187b23e1e80c343b0c`. No stable release newer than
`v0.8.2` exists at that point. `master` advertises terminal protocol `21` and
contains unreleased API additions, so those sources are not vendored or
admitted by the protocol-20 bridge. The stable compatibility reference above
remains unchanged until a release is available for a complete refresh and
stock-daemon validation.

Git history is the synchronization record. The Herdr Web commit above is a
merge ancestor of this repository; there is no separate hand-maintained
adoption ledger.

To update:

```bash
git fetch upstream
git merge upstream/main
```

Keep World implementation in its World-owned directories and resolve only the
small integration seams when an upstream change touches them.
