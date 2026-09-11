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

- Herdr Web: `3fb68ca4cc850ea39277120d74a30b7a038a4f8f`
  (`v0.6.0` plus the mobile terminal keyboard controls merged in upstream PR #89)
- Herdr compatibility: Herdr `v0.9.0`, commit
  `b99002ac99b09e00b4ca692436cb15a6b0d676f1`, terminal protocol `22`

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
