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

- Herdr Web: `e67537b6bdd99fe489584252ba2f84ea070a3193`
  (`v0.5.0` plus its next-development marker)
- Herdr compatibility: Herdr `v0.8.2`, commit
  `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`, terminal protocol `20`

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
