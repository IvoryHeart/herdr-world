# World skills for agent harnesses

Every standalone installer run (fresh or upgrade) and `herdr-world update`
discovers supported harnesses by their existing configuration folders and installs
or refreshes World's integrations. This also happens when World is already up to
date. Discovery uses the paths and overrides below; it never launches a harness
or creates a missing harness configuration folder. Each detected harness gets a
plain installed, updated, skipped or failed report, with the removal command.

Set `HERDR_WORLD_SKIP_INTEGRATIONS=1` for manual-only management, alongside
`HERDR_WORLD_SKIP_HERDR=1` when desired. The options are independent: skipping
Herdr still installs World's integrations; skipping World's integrations still
allows Herdr's upgrades. Set the variable on each installer or update invocation
you want to skip. `update --check` remains read-only. Pinned older World releases
without automatic integration support print that limitation.

`herdr-world integration install <harness>` manually installs the release's
`herdr-world --skill` guide as `herdr-world/SKILL.md` in that harness's user
skill folder. It teaches `ask`, `result`, `task-summary` and `stamp` to an agent
that has never used World. Start a new harness session after installing.
Installation needs no running World or Herdr service. Nothing installs at startup.
`herdr-world integration sync` reruns the automatic discovery and refresh step.

```sh
herdr-world integration status
herdr-world integration install claude
herdr-world integration status claude
herdr-world integration uninstall claude
```

Uninstall records a persistent removal preference. Later installers, updates and
`integration sync` leave that integration removed; explicit `integration install`
(or **Install** in Settings) reenables it. Codex, Pi and Kimi share both their
skill and this preference: uninstalling any one keeps the group removed, and
explicitly installing any one reenables the group. Preferences live in
`~/.config/herdr-world/integrations/<skill-id>.disabled` (on Windows,
`%APPDATA%/herdr-world/integrations/`). Use the install command to reenable;
there is no need to edit these files. Uninstalling an already absent integration
also records the preference.

Status prints `<harness>: <state> (<path or reason>)`: `current (v1)`,
`outdated (v0)`, `not installed` or `unsupported`. A missing or invalid marker
is `outdated` without a version. A valid marker at or above this release's
version is current. Install and uninstall refuse an existing skill without a
valid World marker for that skill's ID, preserving user-owned files; discovery
reports the conflict and continues with other harnesses. Reinstall replaces a
managed World file atomically; uninstall
removes it and its empty `herdr-world/` directory, preserving other files and
the parent `skills/` directory. Claude also registers the limits tap below.
An unreadable file fails with an error rather than pretending it is absent.

The harness's configuration folder must already exist. Run the harness first
if it is missing. World may create `skills/` inside an existing configuration
folder. Shared skills use an existing Codex, Pi or Kimi configuration folder
as the prerequisite, and create `~/.agents/skills/` if necessary.
Codex, Pi and Kimi share one file whose marker ID is `shared`: status for all
three agrees even if only one harness is configured. Uninstalling any one
names the other two that also lose the file.

## Herdr integration upgrades

Rerunning the standalone World installer over an existing installation, or running
`herdr-world update`, upgrades Herdr and refreshes its integrations for detected
Codex, Claude Code and Pi harnesses, plus the installed World plugin. Output names
what changed, what is current and any failures. Put `HERDR_WORLD_SKIP_HERDR=1`
before `sh` in the installer command to skip these changes; World still restarts
its matching running service.

World's own skills and Claude limits tap are refreshed automatically as described
above, independently of the Herdr opt-out. Use
`herdr-world integration uninstall <harness>` to keep one removed.
`herdr-world rollback` restores only World, leaving Herdr and its
integrations in place.

## Paths

Every path below ends in `/herdr-world/SKILL.md`. Roots follow
[Herdr's environment resolution](https://github.com/herdrdev/herdr/blob/master/src/integration/env.rs).
An override replaces the indicated config root; `~` expands to HOME.
Empty overrides use the default. Skill roots follow the harnesses' own
documentation or live discovery, summarized below. Gemini is a separate
usage source, not an integration name in Herdr's list.

| Harness | Default skill root | Config root override | Folder evidence |
| --- | --- | --- | --- |
| `claude` | `~/.claude/skills` | `CLAUDE_CONFIG_DIR` | [Claude skills](https://code.claude.com/docs/en/skills#where-skills-live) |
| `codex` | `~/.agents/skills` | `CODEX_HOME` changes prerequisite only | Live `skills/list` from Codex 0.167.0 |
| `pi` | `~/.agents/skills` | `PI_CODING_AGENT_DIR` changes prerequisite only | Live `get_commands` from Pi 0.87.1 |
| `kimi` | `~/.agents/skills` | `KIMI_CODE_HOME` changes prerequisite only | [Kimi user skill roots](https://moonshotai.github.io/kimi-code/en/customization/skills/) |
| `copilot` | `~/.copilot/skills` | `COPILOT_HOME` | [Copilot config](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) |
| `devin` | `~/.config/devin/skills` | `XDG_CONFIG_HOME` | [Devin skills](https://cli.devin.ai/docs/extensibility/skills) |
| `droid` | `~/.factory/skills` | None | [Factory skills](https://docs.factory.ai/cli/configuration/skills) |
| `opencode` | `~/.config/opencode/skills` | `OPENCODE_CONFIG_DIR`, then `XDG_CONFIG_HOME` | Live `opencode debug skill` |
| `kilo` | `~/.kilo/skills` | Prerequisite: `$XDG_CONFIG_HOME/kilo` (default `~/.config/kilo`) | [Kilo skills](https://kilo.ai/docs/customize/skills) |
| `hermes` | `~/.hermes/skills` | `HERMES_HOME` | [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) |
| `qodercli` | `~/.qoder/skills` | `QODER_CONFIG_DIR` | [Qoder CLI skills](https://docs.qoder.com/cli/Skills) |
| `qwen` | `~/.qwen/skills` | `QWEN_HOME` | [Qwen skills](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md) |
| `cursor` | `~/.cursor/skills` | `CURSOR_CONFIG_DIR` | [Cursor skills](https://cursor.com/docs/context/skills) |
| `antigravity-cli` | `~/.gemini/config/skills` | `ANTIGRAVITY_CLI_CONFIG_DIR` | Live `agy --print /skills` |
| `grok` | `~/.grok/skills` | `GROK_CONFIG_DIR`, then `GROK_HOME` | [Grok skill discovery](https://docs.x.ai/build/features/skills-plugins-marketplaces) |
| `omp` | Unsupported | — | Deliberately unsupported in this slice |
| `letta` | Unsupported | — | Deliberately unsupported in this slice |
| `mastracode` | Unsupported | — | Deliberately unsupported in this slice |

On Windows, Devin uses `%APPDATA%/devin` unless `XDG_CONFIG_HOME` is set;
Hermes uses `%LOCALAPPDATA%/hermes` unless an explicit HOME or `HERMES_HOME`
selects another root. The shared skill root always stays under HOME.
`GROK_CONFIG_DIR` is Herdr's override; Grok itself honors `GROK_HOME`.

## Claude limits tap

`integration install claude` also points the user-scope `statusLine` at
`$CLAUDE_CONFIG_DIR/herdr-world/herdr-world-claude-tap.sh` (the default root is
`~/.claude`). The private `claude-status-line.json` beside it saves the previous
settings bytes, including an absent file or absent `statusLine`. Keep this backup
until uninstall. The script uses World's executable as Bun; it needs no separate
JavaScript runtime. If that executable is missing, it still runs your saved
command with the original input.

The tap records only limits and timestamps in
`~/.cache/herdr-world/claude-status-line.json`. It passes the exact input to your
previous command and preserves stdout, stderr and exit status. New Claude sessions
started outside World now contribute to the host's Claude Fuel gauge too.
Project-specific status lines can override the user setting; World's launcher
still supplies its existing per-session tap and respects those project commands.

Reinstall updates the script without wrapping it twice. Claude status is current
only when the skill, script, backup and settings entry agree. If you change
`statusLine`, status becomes outdated; reinstall saves and chains the new value.
Uninstall restores unchanged settings byte for byte, deleting `settings.json` if
it did not exist. After unrelated edits it restores only the previous raw
`statusLine` value (or removes the key), retaining those edits. A replacement
status line or deleted settings file stays as you left it. Malformed settings,
duplicate `statusLine` keys, unsafe file types and damaged backups fail without
overwriting settings or discarding recovery files. Herdr's `hooks` are preserved.
Edits to the wrapper's display options survive restoration. An altered command
that still references World's wrapper refuses removal and retains its recovery
files, so uninstall cannot leave that command pointing at a deleted script.

For a browser-only preview, open Town with
`?town-economy-preview=claude-tap`. The parameter disappears immediately. Click or
tap **Claude** on the **Fuel** row: it shows a synthetic **5 h 58 % left** reading
from the Claude status line. Reload without the parameter for real observations.
This preview writes no harness settings and requires no account or usage limit.

## Isolated checks

Use a throwaway HOME and XDG directories when testing installs or launches.
Remove inherited harness-root overrides as well; a fake HOME alone does not
override `CODEX_HOME`, for example. If running any Herdr command, also pass
`herdr --session <unique-test-name>`; HOME alone does not isolate Herdr.
Do not launch World or connect tests to an owner's running services.

From a checkout with dependencies installed, run this safe installer exercise:

```sh
bun run test scripts/install-herdr-world.test.ts
```

Look for **throwaway HOME: installer discovers Claude/Codex/Pi, refreshes skills
and update preserves uninstall**. It performs these steps automatically, without
requiring file edits or a running service:

1. Create a throwaway HOME with fake Claude, Codex and Pi configuration folders
   and a synthetic Claude status line. Ignore inherited harness-root overrides.
2. Run the installer against a local fake release archive that delegates to the
   real integration CLI. Check that it reports **installed** for all three and
   writes Claude's skill and tap plus the shared Codex/Pi skill.
3. Make the fixture's skills outdated, rerun the installer, and check **updated**
   reports for all three and refreshed skill markers.
4. Run `integration uninstall claude` and `integration uninstall codex`, then
   `update --finish-install`. Check **skipped (previously uninstalled)** for all
   three, absent skills and exact restoration of the synthetic status line.

The fixture disables service commands and skips Herdr. Separate tests in the same
command check the installer delegation with each opt-out setting. The exercise
deletes its temporary HOME on completion. For a browser inspection after an
automatic install on a disposable host, open **Menu → Configuration → Integrations**
and select World's local connection: the installed **World skill** rows show
**Current**, and **Uninstall** uses the same persistent removal preference.

## Settings

**Menu → Configuration → Integrations** shows a **World skill** line under each
of Herdr's harness rows when the selected connection is World's local host:
its state (Current, Outdated, Not installed, or Unsupported with the reason),
its path, and **Install**, **Update** or **Uninstall**. The buttons call
`world.integration.install|uninstall`, which run the same installer as the CLI
in the World service user's environment, so the row always matches
`herdr-world integration status`. `world.integration.list` reads the rows.
These verbs are browser-only: agent-originated calls are refused. Codex, Pi
and Kimi rows show the shared file; uninstalling from any of them first
confirms which other harnesses lose it. **Refresh** rereads both Herdr's and
World's rows. SSH connections show no World rows yet. The Claude row's
**Install** and **Uninstall** also chain or restore the
[limits tap](#claude-limits-tap), as the CLI does, and the row shows Outdated
when the skill is current but the tap is not.

SSH installation remains a follow-up in [the integration design](../openspec/changes/world-harness-integration/design.md).
