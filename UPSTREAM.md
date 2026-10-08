# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate source: main at `d703e6f6b94bdd418186a8daaaea77bceb78d26c`
  (6 October 2026), including v0.7.15 and subsequent fixes. This synchronization
  records that exact source head as a Git merge parent; the prior source record
  was v0.7.11, `b60a1843579311d830e026fb89ab917052fbaee8`.
- Herdr compatibility: Herdr 0.9.0, terminal protocol 22.

The integration adopts Ranger workspace chat, background and scheduled tasks,
monitoring alerts, Git commit history and file-preview tabs, tab pinning and
reordering, pane movement, terminal input/font/upload improvements, instance
settings, login throttling and mandatory login with 15–1024-character passwords.
Ranger and uploads are adapted to captured World connection generations.

World retains its identity, local/SSH connection ownership, same-origin access,
session-bound push revocation, aggregate visual views, isolated browser storage,
and browser regression coverage. World-specific service, packaging, release,
site and agent tooling remain downstream. Upstream's legacy service migration
and browser-test removal are excluded; World already checks macOS listener
conflicts before installing a service. React and React DOM remain on 18.3.1:
upstream's React 19 upgrade stalls terminal input during World's dense topology
refresh. Dialog callback freshness is adapted without that dependency upgrade.

Future source refreshes should merge from the recorded upstream head, resolve
World-specific conflicts explicitly, and update this record and the changelog.
World does not depend on a separately installed Roamgate process, data directory,
service, or private API. Ranger is configured within World and uses its own
workspace permissions and model credentials.

Use these terms consistently:

- **Derived from** describes copied or synchronized Roamgate application source.
- **Compatible with** describes the external Herdr runtime and protocol.
- **Depends on** is reserved for an independently installed package or runtime.

Each World release records the exact Roamgate synchronization point. Required MIT
attribution is retained in [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
