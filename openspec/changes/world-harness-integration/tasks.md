## Design (this PR)

- [x] Survey hooks, plugins, mods, status line, settings layering, MCP, notify and limit sources for Claude Code, Codex, Antigravity CLI, Gemini CLI, Pi and OpenCode, and what Herdr's integrations install.
- [x] Define package shape, per-host lifecycle, manifest, data channel, migration of #727's tap and slices.
- [ ] Owner decisions in `proposal.md` answered.

## Slice 1: Claude limits from every Claude session

- [ ] Self-contained installer program (Bun or Node) run through the connection runner: `status`, `plan`, `apply`, `remove`; atomic writes with backups; per-host manifest.
- [ ] First check: a user-scope plugin's mod receives `session.measure` in interactive and `-p` sessions and can write the spool path (else use `${CLAUDE_PLUGIN_DATA}`).
- [ ] Claude Code package: `herdr-world` plugin in a World-owned local marketplace with a mod writing `limits` and a `SessionStart` heartbeat; registered with `claude plugin` commands at user scope.
- [ ] Collector: read the spool (new limit source `claude-plugin`) beside #727's file, newest wins.
- [ ] `world.integration.list` (read) and `world.integration.apply` (reconcilable, operator-only) verbs; `herdr-world integration status|install|update|remove <harness> [--host]`.
- [ ] World rows beside Herdr's in Settings → Agent integrations, with the exact preview before writing.
- [ ] Launch rule: no per-launch tap when the session will load the current, enabled plugin with mod support.
- [ ] Tests: install/remove round trip leaves other settings byte-identical; Herdr's files and entries untouched; a disabled plugin stays disabled; unparseable files refused; SSH host isolation; launch rule; spool validation drops extra fields and rejects symlinks; the mod maps windows and drops `spend_limit`.
- [ ] Docs: `docs/usage.md`, `FEATURES.md`, `docs/TUTORIAL.md`, knowledge map; sync the `harness-usage` limits source text; behavioural verification note for the new ownership of configuration entries.

## Slice 2: Codex package and release-following updates

- [ ] Codex package: `herdr-world` plugin with a `SessionStart` heartbeat hook from World's local marketplace (fallback: one World entry in the user's `hooks.json`); `waiting_for_trust` until the first heartbeat.
- [ ] World update and `herdr-world herdr upgrade` refresh installed World packages and report them beside Herdr's integrations.
- [ ] Tests and docs as in slice 1.

## Slice 3: Antigravity CLI, Pi and OpenCode packages

- [ ] Only once a consumer needs data from them; same installer, manifest and spool.
