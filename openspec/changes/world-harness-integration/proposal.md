## Decisions for the owner

Each item has a recommendation. The design follows the recommendation until the
owner decides otherwise.

1. **Follow Herdr's integration paradigm.** World uses Herdr's command shape,
   `herdr-world integration install|uninstall|status <harness>`, with Herdr's
   harness names. Each harness gets one small, versioned, World-named file in
   its own extension folder. The version marker in that file is the
   installation record. Status prints `current (vN)`, `outdated (vN)` or
   `not installed` with the path. Nothing is installed until someone runs
   the install command or clicks Install.
   **Recommend:** yes. This replaces this change's earlier plugin marketplaces,
   per-host manifest, data spool and heartbeat (design D1–D3 say why).
2. **Every harness gets the World skill, and nothing else for now.** The skill
   is the release's `herdr-world --skill` text, saved as a `SKILL.md` in the
   harness's user skill folder, so agents learn `herdr-world ask`, `result`,
   `task-summary` and `stamp`. Today only this repository's agents learn them,
   from AGENTS.md. **Recommend:** yes. It covers all 18 harnesses that Herdr
   integrates today, wherever the harness has a documented user skill folder.
3. **Claude also gets the limits tap from #727, installed as a chained status
   line.** Claude Code passes subscription limits only to its status line
   command. A plugin can't set the status line, and no hook receives the limits.
   `herdr-world integration install claude` writes the tap script beside the
   skill. It points the user's `statusLine` at the script, saves the previous
   value in a World-owned file, and the script runs that previous command with
   the same input and returns its output unchanged. Uninstall restores the
   previous value exactly. This is Herdr's own pattern for Claude: a managed
   file in `~/.claude/hooks/` plus one owned entry in `settings.json`. The
   owner's 2026-11-07 objection was to a hand edit for one feature. This is the
   product's own integration, installed only on request and removed exactly.
   **Recommend:** yes. The alternatives are a Claude Code plugin mod (the
   earlier design: Claude Code 2.1.290 or later, a local marketplace and
   `claude plugin` commands, and it leaves `statusLine` alone) or no tap outside
   World's own launches.
4. **Codex, Pi and the other harnesses get no limits file.** Every Codex
   session already writes `rate_limits` to its rollout, and World reads it on
   every host. Of the other harnesses, only Antigravity CLI passes quota to a
   status line, and nothing in World reads it yet. **Recommend:** skill only
   for every harness except Claude.
5. **Codex, Pi and Kimi share one skill file.** All three read user skills from
   `~/.agents/skills/`. One file serves all of them, and status shows that path
   for each. Uninstalling for one harness removes the file and names the other
   harnesses that lose it. **Recommend:** yes. Herdr refuses to share an
   extension folder between Pi and OMP, because each would load the other's
   code. A shared skill folder is the intended convention, so World shares it.
6. **Harnesses whose user skill folder isn't documented: OMP, Letta and
   MastraCode.** **Recommend:** status shows `unsupported` with the reason, and
   install writes nothing, until slice 1 confirms a folder from the harness's
   own documentation or source.
7. **Herdr's list, not a list of our own.** Gemini CLI isn't on it; Herdr
   integrates Antigravity CLI, which replaced Gemini CLI for Google's consumer
   plans in June 2026. **Recommend:** add a harness when Herdr adds it.

## Why

World reads limits, usage and session state from harness files. Two things
reach agents only through the harness:

- **What World can do for an agent.** Agents outside this repository never
  learn `herdr-world ask`, `result`, `task-summary` or `stamp`, because they
  don't read World's AGENTS.md.
- **Claude's subscription limits.** They reach only the status line. #727 taps
  it in the Claude sessions World starts. Sessions started elsewhere (a plain
  terminal, an IDE, Herdr's own CLI) leave the gauge empty or showing only
  refusals.

The owner asked for World's own integration for every harness (2026-11-07). On
2026-11-08 the owner asked that it cover every harness, stay minimal, and take
Herdr's shape: Herdr already installs one small, versioned file per harness, on
an explicit command, and reports its status.

## What Changes

- **`herdr-world integration install|uninstall|status <harness>`**, with Herdr's
  harness names. Each command works on the host where it runs. Settings → Agent
  integrations shows a World row beside Herdr's row for each harness and host,
  with Install, Update and Remove.
- **One World skill file per harness**: `<user skill folder>/herdr-world/SKILL.md`,
  with Herdr-style `installed by herdr-world` and `HERDR_WORLD_INTEGRATION_VERSION`
  marker lines. Its body is the release's `herdr-world --skill` text.
- **Claude only: the limits tap** at `<Claude config>/hooks/herdr-world-status-line.sh`,
  plus World's `statusLine` entry. The previous value is kept in
  `herdr-world-status-line.json` beside the script. The tap still writes #727's
  existing numbers-only file, so the collector and the gauge don't change.
- **Updates follow World.** `herdr-world herdr upgrade` and a World update
  reinstall World integrations that are `outdated`, as World already does for
  Herdr's. They never install one that isn't there.

## Capabilities

### New Capabilities

- `world-harness-integration`: World's per-harness integration files, their
  explicit install, uninstall and status, coexistence with Herdr's integrations
  and the user's configuration, and the Claude limits tap.

### Modified Capabilities

None now. When slice 2 is built, the `harness-usage` limit source text gains
the installed tap beside the per-launch tap.

## Impact

Design only. This change's PR adds no code, installs nothing and changes no
harness configuration. When built: a self-contained installer run on the host
(locally, or through the host's qualified OpenSSH connection), a CLI command,
two RPC verbs mirroring `integration.list` and `integration.install`, World rows
in the existing Agent integrations settings, an extension of `herdr-world
--skill`, and updates to `docs/usage.md`, `FEATURES.md`, `docs/TUTORIAL.md` and
the knowledge map. Herdr's integrations and the harnesses are unchanged.
