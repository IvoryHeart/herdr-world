# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate source: `84d0955d6eb221a20114fb1788a81579f7c472e1` (upstream `main`,
  25 September 2026). The source was merged into World with Roamgate v0.7.9
  `c07db60b06b1b23a34ed143d47011a6b8330379a` recorded as a Git parent,
  so subsequent upstream merges share an actual merge base.
- Herdr compatibility: Herdr 0.9.0, terminal protocol 22.

The merge carries upstream changes through this commit as one source integration.
World retains its product identity, local/SSH connection ownership and generation
checks, same-origin access, session-bound push revocation, visual views, and
browser regression coverage. Roamgate's browser-test deletion in `a7bc9022` was
intentionally excluded; World-specific service, packaging and documentation
remain downstream. Future source refreshes should merge from the recorded
upstream head, resolve World-specific conflicts explicitly, and update this
commit and the changelog. World does not depend on a separately installed
Roamgate process, data directory, service, or private API.

Use these terms consistently:

- **Derived from** describes copied or synchronized Roamgate application source.
- **Compatible with** describes the external Herdr runtime and protocol.
- **Depends on** is reserved for an independently installed package or runtime.

Each World release records the exact Roamgate synchronization point. Required MIT
attribution is retained in [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
