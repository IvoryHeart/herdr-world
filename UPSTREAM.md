# Upstreams

Herdr World derives its application foundation from
[`powerfooI/roamgate`](https://github.com/powerfooI/roamgate) and connects to the
separately installed [`herdrdev/herdr`](https://github.com/herdrdev/herdr) runtime.

Current synchronization points:

- Roamgate source: v0.8.6, `8cc1685ec616de4acf3034db05c4af2368ca1b93`
  (19 October 2026). This integration records the exact head as a Git merge
  parent, following `5ce1d8d620549226de76321303e7bffa911ae371`.
- Herdr compatibility: Herdr 0.9.5, terminal protocol 22. Windows SSH hosts
  additionally require a running Herdr 0.9.1+ session and Windows PowerShell.

The integration adopts Ranger workspace chat, background and scheduled tasks,
monitoring alerts, Git commit history and file-preview tabs, tab pinning and
reordering, pane movement, terminal input/font/upload improvements, instance
settings, login throttling and mandatory login with 8–1024-character passwords.
Ranger and uploads are adapted to captured World connection generations.
The v0.8.1 refresh added structured workspace and agent mentions, quick model
and thinking controls, custom thinking effort, explicit all-workspace consent in
High mode, and Open worktree actions. It also fixes terminal composition and
shortcut identity and adds independently stored session signing keys and
optional `HERDR_WORLD_PIN` login. World uses Bun 1.4.3 with standard and native
type checks; its full-check script remains separate from Bun's native checker.
The v0.8.2 refresh adds Ranger task-management and close previews, reorganized
settings and chat history, a minimap below compact conversations, and service-owned
SSH bridges to Windows Herdr sessions. Remote Windows file and Git tools remain
unavailable; terminal and native Herdr workspace operations retain qualified
connection ownership.

The v0.8.4 refresh adds installation-management CLI commands, worktree pull-request
badges, File Explorer mutations and selection, mobile terminal input shortcuts,
Windows privilege diagnostics, safer workspace paths and atomic file moves,
and Ranger provider/error handling fixes. The bundled Herdr setup target is 0.9.4.
CLI configuration and service inspection use World-owned state only.

The v0.8.5 refresh adds a searchable desktop shortcut cheat sheet, readable
asynchronous workspace/worktree name suggestions and corrected IME positioning
when terminal cursors are hidden. The owner approved the 8-character password
minimum; startup retains the recommendation for 15+ characters. The handoff demo
is attributed as upstream UI, alongside World screenshots. Documentation and local
checks retain World contracts, navigation, formatting and behavioral verification.

The v0.8.6 refresh adds safe login-token discovery, symlinked user configuration
roots, cross-tab pane dragging and breakout, scrollable overflowing tab strips,
and repository-default or selected branch comparisons. Mobile Message input stays
in flow below each qualified terminal, while World's shared top app bar keeps
Tabs and More reachable across Town, Board and Spaces. Upload completion remains
bound to the original draft or terminal; failed Direct insertion retains the path
without replaying input. World retains its managed-window tab sheet and terminal
screen Back layer; upstream's per-layer history guards and departure handling are
adapted to those layers. React 18 requires synchronous tool-gesture state before
native blur. Herdr setup now pins 0.9.5 with the official five-platform checksums;
its protocol remains 22 and endpoint generation remains 1. Herdr's hotfixes belong
to the external runtime, including its Codex integration migration; World does not
install or restart a user's existing runtime during source integration.

World retains its identity, local/SSH connection ownership, same-origin access,
session-bound push revocation, aggregate visual views, isolated browser storage,
and browser regression coverage. World-specific service, packaging, release,
site and agent tooling remain downstream. The v0.8.4 Bun-free plugin installation
is [adapted and accepted](docs/upstream-follow-ups.md#bun-free-plugin-installation)
in PR #194: released plugin installation uses native World installers and commands,
while preserving cached launcher actions, verified standalone archives, npm/Homebrew
channels, downstream update ownership and explicit Bun source builds.
Upstream workflow/action changes remain a separately reviewed control divergence.
The [disposition ledger](upstream/dispositions.json) accounts for every incoming
commit; [adoption policy](docs/upstream-policy.md) requires human approval of new
or changed exceptions and reconsideration of outstanding work each source sync.
Upstream's legacy service migration
and browser-test removal are excluded; World already checks macOS listener
conflicts before installing a service. React and React DOM remain on 18.3.1:
upstream's React 19 upgrade stalls terminal input during World's dense topology
refresh. Dialog callback freshness is adapted without that dependency upgrade.

Future source refreshes should merge from the recorded upstream head, resolve
World-specific conflicts explicitly, and update this record and the changelog.
The opt-in [upstream automation](docs/upstream-automation.md) checks stable
releases hourly, freezes one target per PR, and separates Codex integration from
independent revision-bound review and protected merging.
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
