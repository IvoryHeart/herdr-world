# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate source: main at `fc7600772b04ac2038a1a35bd1cf44fccb0db872`
  (10 October 2026), including v0.8.1 and the Bun 1.4.3 update. This source
  integration records the exact head as a Git merge parent. The prior source
  record was `d703e6f6b94bdd418186a8daaaea77bceb78d26c`; that sync was
  squash-merged, so this refresh applies its recorded source delta explicitly.
- Herdr compatibility: Herdr 0.9.0, terminal protocol 22.

The integration adopts Ranger workspace chat, background and scheduled tasks,
monitoring alerts, Git commit history and file-preview tabs, tab pinning and
reordering, pane movement, terminal input/font/upload improvements, instance
settings, login throttling and mandatory login with 15–1024-character passwords.
Ranger and uploads are adapted to captured World connection generations.
The latest refresh adds structured workspace and agent mentions, quick model
and thinking controls, custom thinking effort, explicit all-workspace consent in
High mode, and Open worktree actions. It also fixes terminal composition and
shortcut identity and adds independently stored session signing keys and
optional `HERDR_WORLD_PIN` login. World uses Bun 1.4.3 with standard and native
type checks; its full-check script remains separate from Bun's native checker.

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
