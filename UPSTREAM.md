# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate: `c07db60b06b1b23a34ed143d47011a6b8330379a` (v0.7.9, synchronized as a
  merge ancestor before the World rebrand and visual projection)
- Herdr compatibility: Herdr 0.9.0, terminal protocol 22

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
