## Context

World observes agents through Herdr and reads harness files on each host through
the host's qualified local or SSH connection. Two things are missing:

- **Numbers only the harness process sees.** Claude Code writes its subscription
  limits (`five_hour`, `seven_day`) nowhere on disk. #727 reads them from the
  status line's stdin, but only for Claude launches World starts, by adding
  per-launch `--settings`.
- **A channel World owns.** Herdr's integrations report pane state and session
  identity to Herdr's socket. World has no channel of its own into a session for
  World-specific metrics, settings, skills or asks.

The owner wants World's own integration package per harness, installed like
Herdr's, instead of one-off edits of personal settings (2026-11-07).

Facts were checked on 2026-11-07 against Claude Code 2.1.319 (including its
bundled mod API types), Codex CLI 0.167.0, Pi 0.87.1, Gemini CLI 0.57.0,
Antigravity CLI 1.1.10 and Herdr 0.9.3 on a development host, and against each
project's documentation and source (links at the end). OpenCode was not
installed there; its facts come from its documentation only.

## What Herdr's integrations already install

`herdr integration install <harness>` writes one managed script per harness and
registers it in the harness's user configuration. The script header names the
integration and its version (`HERDR_INTEGRATION_ID`, `HERDR_INTEGRATION_VERSION`)
and says updates overwrite it. Each script exits at once unless the session runs
in a Herdr pane (`HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`), and then
sends one `pane.report_agent_session` or state request to Herdr's socket with a
0.5 s timeout.

| Harness | Herdr's file | Registration Herdr adds | What it reports |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/hooks/herdr-agent-state.sh` | A `SessionStart` hook entry (`startup\|resume\|clear\|compact\|fork`) in `~/.claude/settings.json` | Session ID, transcript path and start source for the pane |
| Codex | `~/.codex/herdr-agent-state.sh` | A `SessionStart` entry in `~/.codex/hooks.json`, which the user trusts once in Codex | Session ID for the pane |
| Pi | `~/.pi/agent/extensions/herdr-agent-state.ts` | None: Pi loads every extension in that folder | Session and working/idle state |
| OpenCode | `~/.config/opencode/plugins/herdr-agent-state.js` | None: OpenCode loads every plugin in that folder | Session and state |
| Antigravity CLI | `~/.gemini/config/hooks/herdr-agent-state.sh` | Its hook configuration | Session and state |

World already lists and installs these from Settings → Agent integrations
(`integration.list`, `integration.install` through Herdr's API, with versions
from `herdr integration status`), and `herdr-world herdr upgrade` refreshes them
after a World update.

**Consequence:** session identity (which pane runs which conversation) is
Herdr's job, and World already consumes it. World's packages must not report to
Herdr's socket, reuse Herdr's file names or markers, or touch Herdr's entries.

## What each harness offers

| | Claude Code | Codex | Antigravity CLI | Gemini CLI | Pi | OpenCode |
| --- | --- | --- | --- | --- | --- | --- |
| **Hooks** | 33 events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification`, `Stop`, `SessionEnd`, …) in any settings file or a plugin's `hooks/hooks.json`; stdin has `session_id`, `transcript_path`, `cwd`. Held back until the workspace is trusted | 14 events, Claude-like shape, in `hooks.json`, inline `[hooks]` or a plugin. On by default. Each unmanaged hook runs only after the user reviews it in `/hooks` (`trusted_hash` in `config.toml`); a change needs review again | `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop` in `~/.gemini/config/hooks.json`, `.agents/hooks.json` or a plugin; camelCase stdin | 11 events in `settings.json` or an extension; project hooks fingerprinted | No shell hooks: TypeScript extension events (`session_start`, `agent_settled`, `tool_call`, …) | Plugin functions on session, message, tool and permission events |
| **Plugin code in the session** | **Mods** (2.1.290+): a plugin module with `register(on)`; `session.measure` carries `rateLimits` after each turn; `$.fs` writes files | Plugin hooks only | Plugin hooks only | Extension hooks only | The extension is code | The plugin is code |
| **Status line** | `statusLine` command; stdin has `rate_limits`. A plugin cannot set it (plugin `settings` honours only `agent` and `subagentStatusLine`) | Fixed item list `[tui] status_line` | `statusLine` command in its own `settings.json`; stdin has `quota` (`remaining_fraction`, `reset_time`) and `plan_tier` | Fixed `ui.footer.items` | In-process footer via `ctx.ui.setStatus` | None documented |
| **Package format** | `.claude-plugin/plugin.json` with skills, agents, commands, hooks, mods, MCP, LSP, `bin/`; `claude plugin marketplace add <folder>`, `claude plugin install/uninstall/enable/disable --scope user` (writes `enabledPlugins`); `--plugin-dir` per launch | `.codex-plugin/plugin.json` with skills, MCP servers, apps and hooks; `codex plugin marketplace add`, `codex plugin add/remove NAME@MARKETPLACE` | `plugin.json` with skills, MCP, agents, rules, hooks in `~/.gemini/config/plugins/`; `agy plugin install/uninstall/enable/disable` | `gemini-extension.json` with MCP, context, commands, skills, hooks; `gemini extensions install/link/uninstall` | `.ts` files in `~/.pi/agent/extensions/`, or `pi install <path>` (writes `settings.json`) | `.js`/`.ts` in `~/.config/opencode/plugins/`, or npm names in config |
| **Settings layering** | Managed > `--settings` > project local > project > user; lists merge | Managed > `-c` flags > project (trusted) > profile > user `config.toml` in `CODEX_HOME` | Not documented | System override > project > user > system defaults; flags above all | Project over user | Inline env > project > global, merged |
| **Notify** | `Notification` hook | One `notify` program, JSON argument per turn end | Hooks | `Notification` hook | Extension events | Plugin events |
| **MCP** | `~/.claude.json`, `.mcp.json`, plugins | `[mcp_servers]`, plugins | `~/.gemini/config/mcp_config.json`, plugins | `mcpServers` in settings, extensions | `~/.pi/agent/mcp.json` | `mcp` in config |
| **Subscription limits** | Mods (`session.measure`) and the status line; refusals in transcripts | Every rollout's `token_count` events (`rate_limits`); app-server `account/rateLimits/read` | Status line `quota` | Not documented | None for subscriptions | Not documented |

Three facts shape the design:

1. **Claude limits need no settings edit.** A mod in World's own plugin gets
   every session's `rateLimits` and can write them to the spool. The status line
   is not needed, so the user's `statusLine` stays theirs.
2. **Codex limits need no package.** Every Codex session, however it started,
   writes `rate_limits` to its rollout, and World's collector already reads them
   on every host.
3. **Trust is the harness's.** Codex reviews every unmanaged hook, plugin hooks
   included, and Claude Code holds hooks back in untrusted workspaces. A package
   can be installed and still not run; only a heartbeat proves it runs.

## Goals / Non-Goals

**Goals:** one installable World package per harness, per host; visible state,
versions and heartbeat in Settings; exact removal; one bounded data channel;
Claude limits from every Claude session; #727's tap folded in.

**Non-Goals:** session identity (Herdr's); changing Herdr's integrations;
installing harnesses; writing trust state or passing trust-bypass flags;
editing a user's status line; skills, MCP servers or settings in the first two
slices; network reporting from hooks; Windows hosts in slice 1.

## Decisions

### D1. Package = World-owned files + the harness's own registration

World keeps package sources under its integration folder on each host,
`~/.local/share/herdr-world/integrations/` (the platform data directory
elsewhere). For harnesses with a plugin manager, that folder is a local
marketplace, and World registers it with the harness's own commands; the plugin
then shows in the harness's own UI (`/plugin`, `codex plugin list`,
`agy plugin list`), where the user can disable it.

| Harness | Package | Registered by | Removed by |
| --- | --- | --- | --- |
| Claude Code | Plugin `herdr-world`: a mod writing `limits` on `session.measure`, a `SessionStart` heartbeat | `claude plugin marketplace add <folder>`, `claude plugin install herdr-world@herdr-world --scope user` | `claude plugin uninstall`, `claude plugin marketplace remove` |
| Codex | Plugin `herdr-world` with a `SessionStart` heartbeat hook | `codex plugin marketplace add <folder>`, `codex plugin add herdr-world@herdr-world` | `codex plugin remove`, marketplace remove |
| Antigravity CLI | Plugin `herdr-world` with a `SessionStart` heartbeat hook | `agy plugin install <folder>` | `agy plugin uninstall herdr-world` |
| Pi | `~/.pi/agent/extensions/herdr-world.ts` (heartbeat on `session_start`) | The file itself | Delete the file |
| OpenCode | `~/.config/opencode/plugins/herdr-world.js` (heartbeat on `session.created`) | The file itself | Delete the file |

A local marketplace means a plugin is read from World's folder rather than a
copy, so an update is a folder change plus the harness's update or reload
command. If a harness's marketplace format turns out not to accept a local
folder (the Codex marketplace file layout is not yet confirmed from official
documentation), the fallback is one World entry in that harness's user hook
file, kept in the manifest (D2).

*Rejected:* a chained `statusLine` in the user's Claude settings (it edits the
user's own entry, and the mod makes it unnecessary); per-launch `--plugin-dir`
only (World's launches only, which is #727's gap); Herdr-style scripts named in
settings for Claude (invisible in `/plugin` and gives up skills and MCP later).

### D2. One installer program, one manifest per host

A self-contained installer program, run under Bun or Node through the existing
connection runner (a local process or the host's OpenSSH connection, as the
usage collector runs), has four operations: `status`, `plan`, `apply`, `remove`.
It receives package files and the request on stdin and returns a bounded JSON
report. `plan` lists the exact files, commands and entries it would create or
change; Settings shows that list before `apply`.

The manifest, `~/.local/share/herdr-world/integrations/manifest.json`, records per
harness the package version, the harness version it was installed against, each
created file with its digest, each harness command run, and each configuration
entry World added with the bytes it replaced. Files are written to a temporary
name and renamed; the manifest is written last, so an interrupted run leaves the
previous or the new state and `status` can tell which.

States: `harness_missing`, `not_installed`, `current`, `outdated` (manifest
version below the release's), `changed_by_user` (World's plugin disabled or its
entry or file edited), `waiting_for_trust` (installed, no heartbeat since),
`unsupported` (harness too old, for example Claude Code before mods, or no Bun
or Node on the host) and `unknown`.

### D3. Data channel: a host-local spool, pulled by the collector

Packages write records to `~/.cache/herdr-world/spool/<harness>/<kind>-<scope>.json`:
latest wins, atomic rename, mode 0600, at most 4 KiB. Each record is
`{version, kind, at, package_version, harness_version, …fields}` with fields
allow-listed per kind:

| Kind | Writer | Fields |
| --- | --- | --- |
| `limits` | Claude mod (`session.measure`); #727's tap | Per window: `window_minutes` (300 or 10080), `used_percent`, `resets_at` |
| `heartbeat` | Every package's start hook | `at`, `package_version`, `harness_version` |

`scope` is a short digest of the harness configuration folder (for example
`CLAUDE_CONFIG_DIR`), so two Claude accounts on one host keep separate limit
records without revealing the path. The mod maps `kind` `five_hour` and
`seven_day` to minutes, converts `resetsAt` to epoch milliseconds, and drops
`spend_limit` and everything else. The collector reads the spool with the bounds
it uses for #727's file today (regular file, size cap, no symlinks, numeric
validation) and publishes only validated fields; unknown fields are ignored.

If a mod cannot write outside its plugin data folder, the spool for Claude moves
to `${CLAUDE_PLUGIN_DATA}` and the collector reads it there; the record is the
same. Slice 1 checks this first.

Why a file and not the alternatives:

- **`herdr-world` CLI from the hook:** SSH hosts have no World service or CLI,
  and a network call in every turn adds latency and failure modes to the session.
- **Herdr pane metadata:** only inside Herdr panes, at most 32 keys of 80
  characters shared with every writer, gone with the terminal. It suits live
  per-pane signals later, not account-wide limits from sessions outside Herdr.
- **A World socket on each host:** a new daemon per host; nothing needs push
  latency yet.

Ordered events (asks, answers) are out of scope; they get their own design when
a consumer needs them.

### D4. Coexistence with the user's and Herdr's configuration

- World never edits Herdr's files or entries, never writes under Herdr's
  markers, and never sends to Herdr's socket.
- Registration goes through the harness's own commands where they exist; those
  commands own the settings entries they write (`enabledPlugins`, marketplace
  lists), and their uninstall removes them.
- Where World must edit a file itself (only the D1 fallback), it parses the
  format, adds one World entry, keeps every other key, and refuses a file that
  does not parse.
- If the user disables World's plugin in the harness, World reports
  `changed_by_user` and leaves it disabled; update never re-enables it.

### D5. Migrating #727's per-launch tap

The tap's program and file format stay; who supplies the reading changes.

1. The mod writes the same `limits` record to the spool. For one release the
   collector reads both #727's file and the spool, newest wins; then #727's file
   moves into the spool as the tap's output.
2. At launch, World resolves whether the session will load World's plugin: Claude
   Code supports mods, the plugin is enabled at user scope, and the launch
   directory's project settings do not disable it (the tap already resolves
   Claude's settings precedence). If so, the launch adds no `--settings`;
   otherwise it keeps the per-launch tap.
3. Hosts without the package behave exactly as today.

### D6. Lifecycle authority

Install, update and remove are operator actions through one reconcilable
`world.integration.apply` verb, admitted for the operator and denied for
agent-originated calls, as `integration.install` is today.
`world.integration.list` is a read. An explicit World update or `herdr-world
herdr upgrade` applies `update` to packages already in the manifest and reports
them beside Herdr's integrations.

## How the limits gauge reaches every session

- **Codex:** unchanged. Every session's rollout carries `rate_limits`; the
  collector reads them on each host.
- **Claude Code:** with the package installed, every Claude session on the host
  that loads plugins (any terminal, IDE, Herdr's CLI, World's launcher) writes
  the account's latest limits to the spool after each turn; the collector
  publishes them under a new limit source, `claude-plugin`, read and aged like
  `claude-status-line`. Without it, World's launches keep #727's tap and other
  sessions keep refusal readings.
- **Antigravity CLI** (later): its status line has `quota`, but a plugin cannot
  set it either; its limits wait for a plugin-readable source.

## Slices

1. **Claude limits from every Claude session.** Installer, manifest, Claude
   plugin (mod plus heartbeat), spool reader, `world.integration.*` verbs, CLI,
   World rows in Settings → Agent integrations, launch rule. *Demo:* install on
   a host from Settings, run `claude` in a plain terminal outside World and send
   one prompt; Town's Claude gauge fills with source "Claude plugin". Remove it
   and `claude plugin list` no longer shows it, and the user's settings are as
   before apart from what Claude's own uninstall reverts.
2. **Codex package and updates that follow World.** Codex plugin with heartbeat,
   `waiting_for_trust`, World update refreshing installed packages. *Demo:*
   install Codex on an SSH host; Settings shows "waiting for trust in Codex";
   approve it in Codex's `/hooks`, start a session, and the row shows the
   heartbeat time and Codex version.
3. **Antigravity CLI, Pi and OpenCode packages and the first World skill** (for
   example one teaching `herdr-world ask`), once a consumer needs them. *Demo:*
   the skill appears in the harness's own list and disappears on removal.

## Risks / Trade-offs

- **Mods are new.** They need Claude Code 2.1.290 or later and their API may
  move; the package records the version it was checked against, reports
  `unsupported` below it, and World's launches keep the per-launch tap.
- **Trust can leave a package idle.** Shown as `waiting_for_trust` from the
  missing heartbeat, never as working.
- **Two limit writers during migration.** Same record, latest wins; the launch
  rule avoids a tap in sessions the mod already covers.
- **Harness format drift.** An unknown format reports `unknown` and installs
  nothing.
- **Hosts without Bun or Node.** The installer needs one, as the usage collector
  does; World reports the host as unsupported.

## Sources

- Claude Code: [hooks](https://code.claude.com/docs/en/hooks), [status line](https://code.claude.com/docs/en/statusline), [plugins reference](https://code.claude.com/docs/en/plugins-reference), [plugin CLI](https://code.claude.com/docs/en/plugins/cli-reference.md), [mods reference](https://code.claude.com/docs/en/plugins/mods/reference.md), [settings](https://code.claude.com/docs/en/settings); `session.measure` and `SessionRateLimit` in the API types bundled with 2.1.319
- Codex: [hooks](https://learn.chatgpt.com/docs/hooks), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced), source: [hook trust](https://github.com/openai/codex/blob/main/codex-rs/config/src/hook_config.rs), [hook discovery](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs), [plugin manifest](https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/manifest.rs), [plugin CLI](https://github.com/openai/codex/blob/main/codex-rs/cli/src/plugin_cmd.rs), [rate limit protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs), [status line items](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/status_line_setup.rs)
- Antigravity CLI: [hooks](https://antigravity.google/docs/hooks), [status line](https://antigravity.google/docs/cli/statusline/), [plugins](https://antigravity.google/docs/plugins?tab=cli), [MCP](https://antigravity.google/docs/mcp)
- Gemini CLI: [hooks](https://geminicli.com/docs/hooks/), [hooks reference](https://geminicli.com/docs/hooks/reference/), [extensions](https://geminicli.com/docs/extensions/reference/), [configuration](https://geminicli.com/docs/reference/configuration/)
- Pi: [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- OpenCode: [plugins](https://opencode.ai/docs/plugins/), [config](https://opencode.ai/docs/config/)
- Herdr: `herdr integration status` and the installed integration scripts, Herdr 0.9.3
- World: [#727 status line tap](../../../server/src/usage/claude-tap.ts), [subscription limit sources](../../../docs/usage.md#subscription-limits), [Agent integrations settings](../../../web/src/components/AgentIntegrationsSettings.tsx), [Herdr integration versions](../../../server/src/herdr/integration-versions.ts)
