# World skills for agent harnesses

`herdr-world integration install <harness>` installs the release's
`herdr-world --skill` guide as `herdr-world/SKILL.md` in that harness's user
skill folder. It teaches `ask`, `result`, `task-summary` and `stamp` to an agent
that has never used World. Start a new harness session after installing.
Installation needs no running World or Herdr service. Nothing installs at startup.

```sh
herdr-world integration status
herdr-world integration install claude
herdr-world integration status claude
herdr-world integration uninstall claude
```

Status prints `<harness>: <state> (<path or reason>)`: `current (v1)`,
`outdated (v0)`, `not installed` or `unsupported`. A missing or invalid marker
is `outdated` without a version. A valid marker at or above this release's
version is current. Reinstall replaces the World file atomically; uninstall
removes it and its empty `herdr-world/` directory, preserving other files and
the parent `skills/` directory. No manifest or settings entry is written.
An unreadable file fails with an error rather than pretending it is absent.

The harness's configuration folder must already exist. Run the harness first
if it is missing. World may create `skills/` inside an existing configuration
folder. Shared skills use an existing Codex, Pi or Kimi configuration folder
as the prerequisite, and create `~/.agents/skills/` if necessary.
Codex, Pi and Kimi share one file whose marker ID is `shared`: status for all
three agrees even if only one harness is configured. Uninstalling any one
names the other two that also lose the file.

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

## Isolated checks

Use a throwaway HOME and XDG directories when testing installs or launches.
Remove inherited harness-root overrides as well; a fake HOME alone does not
override `CODEX_HOME`, for example. If running any Herdr command, also pass
`herdr --session <unique-test-name>`; HOME alone does not isolate Herdr.
Do not launch World or connect tests to an owner's running services.

This slice adds no Settings controls, Claude limits tap, SSH installation or
automatic upgrade step. [The approved design](../openspec/changes/world-harness-integration/design.md)
tracks those follow-ups.
