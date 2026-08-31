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

Git history is the detailed synchronization record, and the Herdr Web commit
above is a merge ancestor of this repository. `CHANGELOG.md` repeats only the
per-release baseline correlation; it does not copy the upstream release history
or maintain a separate adoption ledger.

## Release Lineage Convention

Herdr World and Herdr Web keep independent release identities and changelogs. A World version does
not imply a matching Web version, and a Web version is never added as a World changelog section.
Each World release instead records one exact Web baseline: the descriptive upstream version or
marker together with the full synchronization commit from this file. The release helper renders
that correlation as "Herdr Web baseline: Derived from …" and release validation requires it to
match the synchronization point at the tagged commit.

Use these terms consistently:

- **Derived from** describes Herdr Web source synchronized into this repository and then changed
  downstream.
- **Compatible with** describes the external Herdr release and terminal protocol accepted by the
  bridge.
- **Depends on** is reserved for a package or runtime dependency that remains independently
  installed and resolved; it does not describe copied or synchronized Web source.

Record World-owned changes under the current World `Unreleased` section. An adopted upstream
change may be mentioned when it changes the World product, with its upstream attribution and World
integration PR, but do not reproduce the upstream release notes. Update this file's synchronization
point before preparing a World release; the prepared changelog correlation is generated from it.

To update:

```bash
git fetch upstream
git merge upstream/main
```

Keep World implementation in its World-owned directories and resolve only the
small integration seams when an upstream change touches them.
