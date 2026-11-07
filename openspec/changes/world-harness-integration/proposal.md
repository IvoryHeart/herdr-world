## Decisions for the owner

Each item has a recommendation; the design follows it until the owner says otherwise.

1. **Claude limits come from a mod in World's Claude Code plugin, not from the
   user's status line.** Claude Code 2.1.290 and later run plugin modules
   ("mods") that receive a `session.measure` event with the session's
   `rateLimits` after each turn. World's plugin, installed with Claude's own
   `claude plugin` commands, records those numbers in every Claude session on the
   host, including ones World did not start, without touching `statusLine` or
   any other entry in the user's settings.
   **Recommend:** yes. For older Claude Code, keep #727's per-launch tap for
   World's own launches only, and do not offer a chained `statusLine` edit.
2. **First install is a click; updates follow World.** **Recommend:** nothing is
   installed until the user installs a harness package on a host from Settings or
   the CLI. After that, a World update refreshes installed packages, as it
   already does for Herdr's integrations. Nothing is installed by default.
3. **Trust stays with each harness.** Codex runs a new or changed hook or plugin
   hook only after the user reviews it in `/hooks`; Claude Code holds hooks back
   until the workspace is trusted. **Recommend:** World never writes a harness's
   trust state or passes bypass flags; Settings shows "waiting for trust" until
   the package's first heartbeat arrives.
4. **The data channel is a small file per host, read by the existing usage
   collector.** **Recommend:** the file spool in design D3 over a `herdr-world` CLI
   call or Herdr pane metadata, because it works on SSH hosts where no World service
   or CLI runs, adds no latency to the session and needs no new transport.
5. **Session identity stays Herdr's.** Herdr's own integrations already report
   which pane runs which conversation. **Recommend:** World's packages add no
   identity hook; World keeps reading Herdr's reports.
6. **Harness order.** **Recommend:** Claude Code first (slice 1), Codex second
   (slice 2), then Antigravity CLI (its status line carries quota), Pi and
   OpenCode when a consumer needs them. Gemini CLI only on request: Google moved
   its free and Google One users to Antigravity CLI in June 2026. Codex limits
   already arrive from every Codex session through its logs and need no package.
7. **Use the harness's own package manager where it has one.** **Recommend:**
   Claude Code and Codex plugins from a World-owned local marketplace folder,
   Antigravity through `agy plugin`, and a single World-owned file for Pi and
   OpenCode, which load every file in their extension folders. World's own files
   live under `~/.local/share/herdr-world/integrations/` on each host (the
   platform data directory on macOS and Windows).

## Why

World reads subscription limits, usage and session state from harness files. For
Claude Code, the limit numbers never reach a file: #727 reads them from the
status line's stdin by adding a status line tap to each Claude launch World
starts. Sessions started elsewhere
(a plain terminal, an IDE, Herdr's own CLI) get no tap, so the Claude gauge stays
empty or shows only refusals. The owner declined a one-off edit of personal
settings for one feature (2026-11-07) and asked for World's own integration,
installed per harness and per host the way Herdr installs its agent integrations,
carrying World's metrics, settings and data generically.

## What Changes

- Define a **World integration package** per harness: World-owned files plus the
  smallest registration in the harness (a Claude Code plugin with a mod and a
  heartbeat hook; a Codex plugin with a heartbeat hook; an Antigravity plugin; a
  Pi extension file; an OpenCode plugin file). Each package
  is versioned, follows the World release, and is installed, updated and removed
  per host through the host's qualified local or SSH connection.
- Keep a **manifest** per host of every file and setting World added, with the
  value it replaced, so status, update and removal touch only World's own
  entries and restore the user's configuration exactly.
- Define one **data channel**: packages write small, versioned, numbers-only or
  allow-listed records to a host-local spool, and the existing usage collector
  reads them locally or over SSH. No conversation content, paths, session IDs,
  account fields or credentials leave the hook.
- Show World's package beside Herdr's integration for each harness in
  **Settings → Agent integrations**, with state (not installed, current,
  outdated, changed by user, waiting for trust, harness missing), last heartbeat,
  and Install, Update and Remove. The same operations exist in the CLI.
- **Migrate** #727's per-launch tap: a World launch skips `--settings` when the
  session will load World's Claude plugin with mod support, and keeps it as the
  fallback otherwise. Both write the same limits record.

## Capabilities

### New Capabilities

- `world-harness-integration`: World's own per-harness packages, their per-host
  lifecycle and manifest, coexistence with Herdr's integrations and the user's
  configuration, and the bounded data channel.

### Modified Capabilities

None now. The `harness-usage` change's limit sources gain the package as a
writer of the existing Claude status line reading; that delta is written with
slice 1.

## Impact

Design only. No code, no package and no harness configuration change in this
change's PR. When built: a self-contained installer program run through the
existing connection runner, a per-host manifest, package sources under
`integrations/`, two RPC verbs (`world.integration.list`, a reconcilable
`world.integration.apply`), a CLI command, rows in the existing Agent
integrations settings, and updates to `docs/usage.md`, `FEATURES.md`,
`docs/TUTORIAL.md` and the knowledge map. Herdr's integrations, the Herdr World
Herdr plugin and the harnesses themselves are unchanged.
