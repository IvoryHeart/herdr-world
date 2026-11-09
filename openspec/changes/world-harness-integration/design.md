## Context

World observes agents through Herdr and reads harness files on each host
through that host's qualified local or SSH connection. Two things reach an agent
only through its harness:

- **The World skill.** Agents learn `herdr-world ask`, `result`, `task-summary`
  and `stamp` only from this repository's AGENTS.md. `herdr-world --skill`
  prints a guide, but no harness loads it.
- **Claude's subscription limits.** Claude Code passes `rate_limits` only to its
  status line command. #727 taps it per launch (`--settings`) in the Claude
  sessions World starts, and nowhere else.

The owner asked for World's own integration per harness (2026-11-07). On
2026-11-08 the owner asked that it cover every harness, stay minimal and take
the shape of Herdr's integrations. The first draft of this change used
harness plugin marketplaces, a manifest, a data spool and a heartbeat. This
revision drops all four and follows Herdr.

Facts were checked on 2026-11-08 against Herdr 0.9.3 on a development host
(`herdr integration status`, `herdr integration --help`), Herdr's source and
documentation on `master`, Roamgate's source, and the Agent Skills installer
(`npx skills`) that Herdr's documentation recommends for its own skill.
Claude Code facts carry over from the first draft (Claude Code 2.1.319).

## How Herdr integrates harnesses

Source: `src/integration/` and `src/cli/integration.rs` in herdrdev/herdr;
documentation: the Integrations and Agent skill pages.

- **Command:** `herdr integration install|uninstall|status <harness>`, with the
  harness names `pi`, `omp`, `claude`, `codex`, `copilot`, `devin`, `droid`,
  `kimi`, `opencode`, `kilo`, `hermes`, `qodercli`, `qwen`, `letta`
  (experimental, CLI only), `cursor`, `mastracode`, `antigravity-cli` and
  `grok`. Herdr's settings screen has an integrations tab that recommends
  installs for harnesses found on `PATH`.
- **One managed file per harness in the harness's own extension folder:** a
  hook script (`~/.claude/hooks/herdr-agent-state.sh`), a JS or TS plugin
  (`~/.config/opencode/plugins/…`, `~/.pi/agent/extensions/…`) or a Python
  plugin folder (`~/.hermes/plugins/herdr-agent-state/`). Herdr resolves the
  folder from the harness's own variable when set (`CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `PI_CODING_AGENT_DIR`, `HERMES_HOME`, `GROK_HOME`, …). The
  harness's config folder must already exist, so Herdr never creates a
  harness's home.
- **Registration only where the harness needs it:** Herdr adds its own hook
  entries to `settings.json` or `hooks.json`, or a Herdr-named block, or a
  self-contained `hooks/herdr.json` where the harness merges every file in a
  folder. Folders that load every file (Pi, Kilo) need no registration.
- **Version marker in the file:** a header that says `installed by herdr` and
  `managed by herdr; reinstalling or updating the integration overwrites this
  file`, then `HERDR_INTEGRATION_ID=<harness>` and
  `HERDR_INTEGRATION_VERSION=<n>`. The expected version is a per-harness
  integer in Herdr's source, raised when the file changes.
- **Status from the file alone:** a missing file means `not installed`. A
  marker at or above the expected version means `current (vN)`; anything else
  means `outdated`. Where the file isn't enough (Grok's hook config, OpenCode's
  TUI registration), a missing or broken registration also means `outdated`.
  Status prints one line per harness, `<harness>: <state> (<path>)`. Herdr keeps
  no manifest or other installation record.
- **Removal:** uninstall deletes the managed file and only Herdr's own entries,
  and leaves the rest of the harness configuration as it was.
- **Writes:** atomic on Linux and macOS. A configuration file that doesn't
  parse is refused.
- **Updates:** Herdr prints a notice listing outdated integrations, and
  reinstalling updates them. World's `herdr-world herdr upgrade` already
  reinstalls Herdr's outdated integrations after an upgrade.
- **Skill:** `herdr --skill` prints the copy that matches the release.
  `herdr integration install` doesn't install a skill. Herdr's documentation
  points users to `npx skills add herdrdev/herdr --skill herdr -g`, which puts
  `herdr/SKILL.md` in each detected harness's user skill folder.

## What Roamgate does

Nothing per harness. Roamgate lists Herdr's integration versions and installs
them through Herdr's API (World inherited this as Settings → Agent
integrations). Its Ranger assistant passes a per-turn `--mcp-config` to the
Claude Code process it starts itself. `scripts/codex-herdr.sh` is a shell
function the user sources. Roamgate writes no skill, plugin or hook into any
harness folder, so it has no pattern for World to adopt. Herdr's is the only
one.

## What World installs per harness

The skill folder is the user-scope folder from the Agent Skills installer's
harness table (`src/agents.ts` in vercel-labs/skills). That is the tool
Herdr's skill documentation uses, and it resolves the same variables Herdr does.

| Harness | Herdr's file today | World skill file (`…/herdr-world/SKILL.md`) | World limits |
| --- | --- | --- | --- |
| `claude` | `~/.claude/hooks/herdr-agent-state.sh` + `settings.json` hooks | `$CLAUDE_CONFIG_DIR/skills/` (`~/.claude/skills/`) | Tap: `~/.claude/herdr-world/herdr-world-claude-tap.sh` + `statusLine` (D3) |
| `codex` | `~/.codex/herdr-agent-state.sh` + `hooks.json` | `~/.agents/skills/` (shared) | None needed: rollouts carry `rate_limits` |
| `pi` | `~/.pi/agent/extensions/herdr-agent-state.ts` | `~/.agents/skills/` (shared) | None: no subscription limits |
| `kimi` | `~/.kimi-code/hooks/herdr-agent-state.sh` + `config.toml` | `~/.agents/skills/` (shared) | None exposed |
| `copilot` | `~/.copilot/hooks/herdr-agent-state.sh` + `settings.json` | `~/.copilot/skills/` | None exposed |
| `devin` | `~/.config/devin/herdr-agent-state.sh` + `config.json` | `$XDG_CONFIG_HOME/devin/skills/` | None exposed |
| `droid` | `~/.factory/hooks/herdr-agent-state.sh` + `settings.json` | `~/.factory/skills/` | None exposed |
| `opencode` | `~/.config/opencode/plugins/herdr-agent-state.js` + TUI config | `$XDG_CONFIG_HOME/opencode/skills/` | None exposed |
| `kilo` | `~/.config/kilo/plugin/herdr-agent-state.js` | `~/.kilo/skills/` | None exposed |
| `hermes` | `$HERMES_HOME/plugins/herdr-agent-state/` + `config.yaml` | `$HERMES_HOME/skills/` | None exposed |
| `qodercli` | `~/.qoder/hooks/herdr-agent-state.sh` + `settings.json` | `~/.qoder/skills/` | None exposed |
| `qwen` | `~/.qwen/hooks/herdr-agent-session.sh` + `settings.json` | `~/.qwen/skills/` | None exposed |
| `cursor` | `~/.cursor/herdr-agent-state.sh` + `hooks.json` | `~/.cursor/skills/` | None exposed |
| `antigravity-cli` | `~/.gemini/config/hooks/herdr-agent-state.sh` + `hooks.json` block | `~/.gemini/config/skills/` | Not now (status line `quota`, see Risks) |
| `grok` | `~/.grok/hooks/herdr-agent-state.sh` + `hooks/herdr.json` | `$GROK_HOME/skills/` | None exposed |
| `omp` | `~/.omp/agent/extensions/herdr-omp-agent-state.ts` | Not documented: `unsupported` until confirmed | None |
| `letta` | `~/.letta/hooks/herdr-agent-session.sh` + `settings.json` | Not documented: `unsupported` until confirmed | None |
| `mastracode` | `~/.mastracode/hooks/herdr-agent-state.sh` + `hooks.json` | Not documented: `unsupported` until confirmed | None |

Removal deletes World's `herdr-world/` skill folder. For Claude it also deletes
the tap script and its saved-value file and restores `statusLine`. Nothing else
is touched.

## Goals / Non-Goals

**Goals:** Herdr's command shape, harness names and status for World's own
integration; the World skill for every harness that has a skill folder; Claude
limits from every Claude session on a host that has the tap; World rows in
Settings for local and SSH hosts.

**Non-Goals:** session identity and agent state (Herdr's); changing Herdr's
integrations; installing harnesses; MCP servers, World settings, asks or other
hooks; new data channels; writing a harness's trust state.

## Decisions

### D1. Herdr's paradigm, adopted whole

World mirrors Herdr's command, names, file placement, marker and state words.
The earlier draft is dropped where it differs:

- **Files, not harness plugin managers.** Herdr writes files directly, so
  install needs no harness CLI and behaves the same on every harness. Plugin
  marketplaces worked for only three harnesses, needed each harness's CLI on the
  host, and made World depend on three different update flows.
- **No manifest.** The marker in World's file is the record, as in Herdr. With
  one file per harness (two for Claude) and one owned entry, a manifest records
  nothing the files don't already show.
- **No spool or heartbeat.** The skill sends no data. The Claude tap keeps
  writing #727's existing file (D4). A heartbeat existed only to show a hook
  that the harness hadn't trusted yet. A skill needs no trust. For the status
  line, see Risks.
- **Same names, distinct files.** World's files carry `herdr-world` in their
  names and markers (`HERDR_WORLD_INTEGRATION_ID`,
  `HERDR_WORLD_INTEGRATION_VERSION`), so neither tool's status ever reads the
  other's file.

World differs from Herdr in two places:

- **Hosts.** Herdr's command acts on its own host. World's CLI does the same,
  and World's Settings run the same installer on any host through that host's
  qualified local or OpenSSH connection, with the usage collector's runner.
  Nothing falls back to another connection.
- **Claude's single-value setting.** Herdr only adds entries to lists. World's
  tap must own `statusLine`, which holds one value, so World saves the previous
  value and restores it exactly (D3).

### D2. The World skill

- **Path:** `<harness user skill folder>/herdr-world/SKILL.md`. The table above
  lists the folders. Install refuses with Herdr's message when the harness's
  config folder doesn't exist, and creates `skills/` inside it when that is
  missing.
- **Content:** Agent Skills frontmatter (`name: herdr-world`, a one-line
  `description` naming ask, result, task summary and stamp). Then an HTML
  comment with the Herdr-style marker lines (`installed by herdr-world`,
  `managed by herdr-world; reinstalling or updating overwrites this file`,
  `HERDR_WORLD_INTEGRATION_ID=<harness>`, `HERDR_WORLD_INTEGRATION_VERSION=<n>`).
  The body is the release's `herdr-world --skill` text. There is one source:
  slice 1 adds `task-summary` to that guide, which today covers `ask`,
  `result` and `stamp`.
- **Version:** one integer for the skill, raised whenever the guide text
  changes. A test pins the text's digest to the version, so a text change
  without a version bump fails.
- **Shared folder:** Codex, Pi and Kimi read `~/.agents/skills/`. One file
  serves all three, and its ID is `shared`. Status shows the same path and state
  for each of them. Uninstalling any of the three removes the file, and the
  output names the other harnesses that lose it.

### D3. The Claude limits tap

`herdr-world integration install claude` also:

1. writes `$CLAUDE_CONFIG_DIR/herdr-world/herdr-world-claude-tap.sh`: a
   World marker header, then #727's tap program run by World's executable as Bun;
2. writes `claude-status-line.json` beside it, mode 0600, holding the
   previous and installed settings bytes, including an absent file or key;
3. sets `statusLine` in `$CLAUDE_CONFIG_DIR/settings.json` to
   `{ "type": "command", "command": "<script path>" }`. The file is parsed and
   every other key kept. A file that doesn't parse is refused.

The tap's chaining rule gains one case. When the effective `statusLine` it finds
is World's own script, it runs the saved previous command instead. In both
cases it passes the same stdin and returns the output unchanged. If the
runtime is gone, the script still runs the saved command. Uninstall puts back
unchanged settings byte for byte, removing the file or key if originally absent,
then deletes both files. Intervening unrelated edits survive; a replaced status
line or deleted file stays as the user left it. Malformed settings or backups are
refused without discarding recovery files.
Herdr's Claude hook entries live under `hooks`, which World never touches.

Status for `claude` is `current` only when the skill, the script, the saved
value and the `statusLine` entry are all present and current. If the user has
since changed `statusLine`, status reports `outdated`, as Herdr does for a broken
registration. A reinstall then saves the user's new value and chains to it
again.

A project's own `statusLine` (`.claude/settings.json` or
`settings.local.json`) overrides the user's. Sessions in such a project get no
readings, unless World started them, in which case #727's per-launch tap still
applies.

### D4. Data channel: none new

The skill carries no data. The installed tap writes the file #727's tap writes
today (`~/.cache/herdr-world/claude-status-line.json`). That is one
numbers-only record, at most 4 KiB, holding per window `window_minutes`,
`used_percent` and `resets_at`. The collector already reads it through the
host's qualified connection, with its existing bounds: a regular file, a size
cap, no symlinks, numbers checked. No conversation content, paths, session IDs,
account or plan fields, or credentials are written. A future integration that
needs to send World more data gets its own design.

### D5. Migrating #727's per-launch tap

The per-launch tap stays, unchanged except for D3's chaining rule. It
covers World's launches on hosts without the installed tap, and in projects that
override `statusLine`. When both taps apply, the per-launch one wins for that
session and still chains to the user's command, so the output and the record are
the same. No launch rule is needed. If later evidence shows the per-launch tap
is never needed on hosts where the installed tap is current, removing it is a
separate change.

### D6. Status, Settings and updates

- `herdr-world integration status` prints Herdr's format for every harness, for
  example `codex: current (v1) (~/.agents/skills/herdr-world/SKILL.md)`,
  `omp: unsupported (no documented skill folder)`, `copilot: not installed (…)`.
- Settings → Agent integrations shows, per host and harness, World's row
  beside Herdr's: state, version, path, and Install, Update or Remove. Like
  Herdr, Settings recommends an install only for harnesses found on the host.
  An unreachable host shows its last-known state as stale, with no actions.
- After `herdr-world herdr upgrade`, or an explicit World update, World
  reinstalls only its own integrations that are `outdated`, beside Herdr's.
  Nothing new is installed.
- **Authority:** install and uninstall are operator actions:
  `world.integration.install` and `world.integration.uninstall` (reconcilable),
  and `world.integration.list` (read). Each mirrors the existing
  `integration.*` admission: allowed for the operator, denied for
  agent-originated calls.

## How the limits gauge reaches every session

- **Codex:** unchanged. Every session's rollout carries `rate_limits`, and the
  collector reads them on each host, whoever started the session.
- **Claude Code:** with `claude` installed on a host, every Claude session there
  that uses the user status line writes the account's latest limits after each
  turn. That includes a plain terminal, an IDE, Herdr's CLI and World's launcher.
  The collector publishes them under the existing source,
  `claude-status-line`. Without it, World's own launches keep #727's per-launch
  tap, and other sessions keep refusal readings only.
- **Every other harness:** no limits source is exposed to hooks or plugins
  today.

## Slices

1. **The World skill for every harness, on the local host.** The installer, the
   `herdr-world integration install|uninstall|status` CLI, `task-summary` added
   to `--skill`, and World rows in Settings → Agent integrations for the local
   host. *Demo:* Settings → Agent integrations shows a World row under each
   Herdr harness, for example Codex "Not installed" and OMP "Unsupported". Click
   Install on Codex: the row turns "Current (v1)", and a new Codex session lists
   the `herdr-world` skill. Click Remove: the row returns to "Not installed".
2. **The Claude limits tap.** The D3 script, saved value and entry; the
   chaining rule; status checks. *Demo:* on a host with a status line of its
   own, click Install on Claude. Run `claude` in a plain terminal outside
   World and send one prompt. The user's own status line still shows, and
   Town's Claude gauge fills. Click Remove, and `statusLine` is exactly as it
   was.
3. **SSH hosts and updates.** The same installer through each host's qualified
   connection, stale rows for unreachable hosts, and reinstalling outdated
   integrations on upgrade. *Demo:* install Codex's skill on an SSH host from
   Settings, then upgrade World with a raised skill version: the row goes from
   "Outdated (v1)" to "Current (v2)".

## Risks / Trade-offs

- **Claude may not run the status line in an untrusted folder.** Readings are
  then missing for that session. The gauge ages them as stale, as it does
  today.
- **The tap owns a single-value setting.** If the user replaces `statusLine`,
  World stops getting readings and status shows `outdated`. World never
  re-registers on its own.
- **Skill folders move.** The table follows the Agent Skills installer as of
  2026-11-08. A harness that moves its folder makes World's file inert. Slice 1
  pins each path in a test, and a harness without a confirmed folder shows
  `unsupported`.
- **Shared folder.** Uninstalling for Codex also removes Pi's and Kimi's copy.
  The output names them.
- **Antigravity CLI quota.** Its status line receives `quota`, the same shape of
  problem as Claude's. Leave it out until a consumer needs it; then a slice adds
  the same tap.
- **Hosts without Bun or Node:** the skill installs, but the Claude tap reports
  `unsupported`, as #727's tap does today.

## Sources

- Herdr: [integration source](https://github.com/herdrdev/herdr/tree/master/src/integration) (`mod.rs` versions and markers, `registry.rs` status rules, `assets/`), [CLI](https://github.com/herdrdev/herdr/blob/master/src/cli/integration.rs), [Integrations](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/integrations.mdx), [Agent skill](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/agent-skill.mdx), [skill](https://github.com/herdrdev/herdr/blob/master/skills/herdr/SKILL.md), [llms.txt](https://herdr.dev/llms.txt); `herdr integration status` on Herdr 0.9.3
- Roamgate: [repository](https://github.com/powerfooI/roamgate) (`server/src/herdr/integration-versions.ts`, `server/src/assistant/claude-mcp.ts`, `scripts/codex-herdr.sh`); see `UPSTREAM.md`
- Agent Skills installer: [harness skill folders](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)
- Claude Code: [status line](https://code.claude.com/docs/en/statusline), [settings](https://code.claude.com/docs/en/settings), [skills](https://code.claude.com/docs/en/skills), [plugins reference](https://code.claude.com/docs/en/plugins-reference) (mods, the alternative in decision 3)
- Codex: [rate limit protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
- Antigravity CLI: [status line](https://antigravity.google/docs/cli/statusline/)
- World: [#727 status line tap](../../../server/src/usage/claude-tap.ts), [World CLI guide](../../../server/src/cli/world-skill.ts), [subscription limit sources](../../../docs/usage.md#subscription-limits), [Agent integrations settings](../../../web/src/components/AgentIntegrationsSettings.tsx), [Herdr integration versions](../../../server/src/herdr/integration-versions.ts), [Herdr upgrade](../../../server/src/herdr/upgrade.ts)
