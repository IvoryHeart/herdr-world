## Design (this PR)

- [x] Research Herdr's integration paradigm (source, docs, `herdr integration status`) and Roamgate; adopt Herdr's shape.
- [x] Per-harness table for all Herdr harnesses: Herdr's file, World skill file, World limits.
- [x] Define the skill, the Claude limits tap, status, Settings, updates, the migration of #727's tap and slices.
- [x] Owner decisions in `proposal.md` answered (owner approved PR #740 and its recommendations on 2026-11-08).

## Slice 1: the World skill for every harness, local host

Issue #803 implements the CLI and skill; issue #804 adds the Settings/RPC
items for the local host. Slices 2 and 3 remain separate.

- [x] Add `task-summary` to `herdr-world --skill`; pin the guide's digest to the skill version.
- [x] Self-contained installer: `status`, `install`, `uninstall` per harness name; folder resolution from Herdr's variables; atomic writes; marker parsing; shared `~/.agents/skills/` rule.
- [x] Confirm each skill folder in the table against the harness's own documentation or source; leave unconfirmed ones `unsupported`.
- [x] `herdr-world integration install|uninstall|status <harness>` in Herdr's output form.
- [x] `world.integration.list|install|uninstall` verbs (operator only) and World rows beside Herdr's in Settings → Agent integrations.
- [x] Tests: per-harness paths and variables; status states; missing config folder; shared-folder uninstall names; Herdr's files untouched.
- [x] Agent-originated install/uninstall calls denied (with the Settings/RPC item).
- [x] Docs: `docs/usage.md`, `FEATURES.md`, `docs/TUTORIAL.md`, knowledge map.

## Slice 2: the Claude limits tap

- [ ] Tap script, saved previous `statusLine`, `settings.json` entry; uninstall restores exactly.
- [ ] Tap chaining rule: World's own script found as `statusLine` runs the saved command.
- [ ] `claude` status checks script, saved value and entry; a replaced `statusLine` reports `outdated`.
- [ ] Tests: round trip leaves other keys identical; unparseable settings refused; Herdr's `hooks` entries untouched; output passed through unchanged; runtime missing still runs the user's command.
- [ ] Docs: subscription limit sources in `docs/usage.md`; `harness-usage` source text.

## Slice 3: SSH hosts and updates

- [ ] Run the installer through each host's qualified connection; stale rows for unreachable hosts.
- [ ] `herdr-world herdr upgrade` and World update reinstall only `outdated` World integrations, reported beside Herdr's.
- [ ] Tests: host isolation; upgrade installs nothing new.
