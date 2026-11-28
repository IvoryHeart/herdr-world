# Herdr World agent guide

## How World works

World is one object. The service derives it from the sources of record, every view only displays it, and every change goes back through it to its source. Design: [`openspec/changes/world-one-object/`](openspec/changes/world-one-object/design.md); code map: [world-model notes](openspec/specs/world-model/notes.md).

**Sources of record.** Each fact has one owner, and the owner wins when World disagrees; [sources.md](openspec/changes/world-one-object/sources.md) lists every fact. Every external system is an integration. Some are available by default, others are connected when needed:

- Available by default:
  - Runtimes. Each runtime (today the Herdr TUI and herdr-core; more may come) is its own integration and owns its own entities; never assume a fixed set. The Herdr TUI owns its workspaces (rooms), tabs and panes with their names, order and cwd, plus agent kind and status; herdr-core owns its terminals and their labels, while its rooms and tabs live in World's `core_topology` store.
  - Git and forges: branches, status, diffs, worktrees, pull requests and checks.
  - Harness files of every supported harness (`server/src/agent/chat-harnesses.ts`): transcripts, running sessions, harness settings, skills, memory, usage and login.
- Further integrations: Jira (the issues and bugs assigned to you), deployments (other local World instances and releases) and the rest; their secrets live in the Vault.
- World's own stores: World owns the facts no integration owns (Board, colours, pins, groups, profiles, asks, history and more) in `world.sqlite`, `settings.json` and `connections.json`. `server/src/storage/catalog.ts` lists every table, file and key.

**Views only display it.** Town, Desk, Board, Spaces and the CLI read the published object: the service derives it once and serves it as `world.snapshot` under one revision, each browser holds one replica, and the CLI reads it on the service. A view never keeps its own copy, derives a fact itself (a name, colour, room, grouping, status) or writes to a runtime or store around World. Per-browser presentation (camera, zoom, selection, open windows, drafts) is not a World fact; if another view, browser or the CLI must agree on it, it is one.

**The write path.**

1. Command: the view sends `world.command` with the entity (connection ID, runtime generation, entity ID), the field, the value it shows and the new value.
2. Check: World refuses an unknown entity, an offline or stale host, a changed generation, or a name that changed since the view showed it; otherwise it records the command.
3. Send: a World-owned fact is committed to its store; a runtime fact is sent on that entity's own connection and generation, never another.
4. Observe: a store commit is its own observation. A runtime acknowledgement only moves the host's epoch; World takes the value from the first read that started after it.
5. Publish: the new revision reaches every view in every browser and the CLI.

Until then the pending value sits in the browser replica, shared by all its views. Every accepted command and its outcome is a history entry in `ledger_changes`.

Example: a room's name is owned by the Herdr TUI (or by `core_topology` for a herdr-core room). Renaming it in Town calls `renameRoomThroughWorld` → `world.command` → `workspace.rename` on that room's connection → the next read sees the new name → every view shows it. A new shared setting lives in `settings.json` (listed in `server/src/storage/catalog.ts`), is published in `world.snapshot` and changes through a `world.command`, as "Group runtimes" does (`server/src/world/setting-commands.ts`); never in browser storage.

**Where things are.** Derivation, revision and epoch fence: `server/src/world/snapshot.ts`, shared derivations in `shared/` (`shared/hostGrouping.ts`). Commands: `server/src/world/commands.ts`, `server/src/service/world-commands.ts`. History: `server/src/world/world-ledger.ts`. Browser replica and pending values: `web/src/world/runtimeStore.ts`, `web/src/world/worldReplica.ts`, `web/src/world/worldCommands.ts`. Model: `quint/world-write-path.qnt`. Cross-view test (one snapshot; every view and the CLI agree): `server/src/world/world-cross-view.test.ts`.

**Migration status.** The move is under way, one fact per step; [tasks.md](openspec/changes/world-one-object/tasks.md) is the only status, so this guide keeps no list of finished steps. A fact is on the World path when its step is ticked there and views change it only through `world.command`; until then its view-side derivation or direct runtime write is legacy, and you never add to it. Every World-as-one step PR ticks its step in tasks.md and, if the step changes how agents must work, updates this section in the same PR.

**When you change something.** New state joins the World object and its source of record, not a view: derive it on the service, publish it in `world.snapshot`, write it through a World command and add it to the cross-view test. A fix that works in one view only is not a fix.

## Hard rules

- Never commit or push to `main`. For PR delivery, open a ready PR and stop; merge only when a maintainer explicitly asks.
- Independent review is required unless explicitly waived by a maintainer; never bypass protection or hooks.
- Create worktrees under `.agents/worktrees/` with `bun run agent:worktree -- create <slug> <parent-ref>` after resolving the parent.
- Preserve others' edits and worktrees; never move or clean another agent's worktree.
- Use synthetic data and reserved domains; never publish private hosts, usernames, paths, sockets, keys, tokens, sessions or repository contents. Inspect diff/history before pushing.
- Scan committed additions with `bun run check:privacy` before any push. Never copy material from `.agents/` into tracked paths without that scan; keep owner-only research in gitignored `research-local/`. Privacy CI checks each PR change once; the hook scans every pushed ref.
- Local-first, trusted-single-user: LAN binding, authentication, uploads, shell/terminal operations and update installation are security-sensitive.
- Storage catalog rule: changes that add or alter persisted data (a table, data-folder file, browser storage key or Board document field) must list it in `server/src/storage/catalog.ts` with its owner, identity and limit; prefer an existing store; a new table or data file needs the owner's approval in the mandate; never automatically trim user data.
- World is one object: views display it and write through it, never around it; see [How World works](#how-world-works). A fix that works in one view only is not a fix.
- Harness work covers every supported harness (`server/src/agent/chat-harnesses.ts`). A harness that can't support a feature is marked planned or not supported, with the reason. Never build for Claude and Codex alone.
- Qualify downstream operations by immutable connection ID and runtime generation; never fall back to another connection.
- Aggregate observation is bounded and read-only; failed-host cached topology is stale and non-actionable.
- Keep the browser on one World origin; never restore bridge Host, Origin or cross-origin CSP configuration. Sole exception: IDE pages may frame VS Code's webview origin (`https://*.vscode-cdn.net`).
- SSH profiles accept OpenSSH aliases or `user@host`; policy belongs in OpenSSH config. Never persist passwords, keys, passphrases or arbitrary SSH options.
- Feature PRs do not regenerate Help pictures unless adding or changing a help entry; capture only those entries with `HELP_PICTURES_IDS="<id>" bun run help:pictures`. Stale fingerprints warn; the broken automatic refresh bot is removed; capture changed entries explicitly.
- Never commit generated `web/dist/`, `server/public/`, binaries, `.pages-dist/` or `dist/`.
- Use `fix:` or `feat:` PR titles for release notes (squash merge preserves the title). Release-please owns `CHANGELOG.md` and release version updates; no change fragments.
- Feature PRs never edit `scripts/web-asset-budget.json` or `scripts/check-web-assets.mjs` to accommodate bundle growth. Request a separate owner-approved budget-data PR with the exact raise printed by Web asset headroom and a short reason history; main's status and workflow summary show remaining headroom. Lowering the budget is free; other asset limits stay unchanged.
- Non-documentation PRs require plain `Spec impact:` and `Verification impact:` lines naming changed specs/OpenSpec changes and evidence/owners/checks, or `none — <reason>`; `check:pr-body` enforces presence and diff consistency, and reviewers assess the decision.
- Update current docs with significant product, API, configuration, installation or workflow changes:
  - Capability `notes.md`: controls, menu paths, shortcuts, edge cases and source ownership.
  - `FEATURES.md` is generated by `build:site`; never edit or commit it.
  - `docs/TUTORIAL.md`: only learner steps; run `bun run build:site` after tutorial/site changes.
  - `README.md`: only first-run changes; update operational/contributor guides as applicable.
  - Name updated docs in the handoff, or explain why existing guidance remains accurate.
- Synchronize delivered contract changes and their consumer mappings in the same change; unfinished requirements stay in active deltas.
- Functional commits only; keep verification metadata in the PR. One review/fix pass, in place; split PRs with too many findings.
- Record exact upstream synchronization in `UPSTREAM.md`: source is “derived from”; external runtimes are “compatible with”.
- Prepare releases on clean branches from `origin/main` through reviewed PRs; tag/package only the merged, verified release commit.

## Where things are

One Bun service and same-origin React Web/PWA; Herdr TUI and herdr-core are external runtimes.

- Browser: `web/src/`; RPC/state: `web/src/api.ts`, `web/src/store.ts`.
- World views/store: `web/src/world/`.
- Service: `server/src/`; TUI connections: `server/src/connections/`, `server/src/bridge/`; core: `server/src/herdr-core/`.
- Aggregate: `server/src/world/snapshot.ts`, `server/src/world/runtime-registry.ts`.
- Distribution: `scripts/`, `herdr-plugin.toml`.

Start with OpenSpec (`bun run spec -- <arguments>` invokes this checkout's pinned CLI):

1. Run `openspec list --specs --json` for capabilities and `openspec list --json`
   for work in progress. Use `openspec show <id>` to inspect a capability or change.
2. Read the capability's `openspec/specs/<capability>/spec.md` and adjacent
   `notes.md`; active changes hold requirements not yet archived into the current spec.
3. Follow the notes' Code paths to source and tests, checking every listed surface,
   including other views, CLI entry points and both runtimes.

Contracts live only in OpenSpec; notes own navigation and usage. Do not use `-m` when searching docs.
`docs/specs/` is history. Read relevant source/tests before editing.
Feature PRs edit `openspec/changes/<slug>/` deltas, code and capability notes, never
current `openspec/specs/**/spec.md` directly. Update the capability's `notes.md`
Code list in the same feature PR, including new storage and rendering paths, even
while its spec delta remains active; notes must not wait for archival.
Completed merged deltas are synchronized through reviewed archive PRs with the pinned
archive helper, in merge date order and stopping at the first conflict. The broken
automatic archive bot is removed. Never push to main. Keep one coherent change as direction changes.

## Work loop

Install: `bun install --frozen-lockfile`; hooks: `bun run install-hooks` once per clone.
Tests sit beside source: `bun run test <path>`; direct `bun test` refuses.
`bun scripts/affected.ts origin/main` lists branch impact.
`bun run check:dead` reports production-only unused code (new findings fail) and largest copied blocks (report only) in `.agents/dead-code/`; place test support in `testing/` or `*.{fixture,cases,browserMock}.*` (development-only entries), move renamed nonstandard test helpers there, and mark intentional test-seam exports in production code `/** @internal */`; never pad the baseline, and use `bun run check:dead --prune` explicitly and commit resolved baseline entries with their fixes.
Browser suites need Chrome/Chromium (`CHROME_BIN`) and queue machine-wide.
Use one preview per worktree, with its own port/data folder and synthetic Herdr session: [recipe](docs/development.md#isolated-worktree-preview).
Pre-push runs read-only formatting and privacy only. Static/unit/browser/behavioral checks run in CI; `check:delivery` explicitly runs all local lanes.
After committing, run `bun run check:pr-body <file>` on the exact PR body; append stacked base ref.
For stacked PRs: `bun run check:size origin/main <ref>`.
Dependency graph changes: `bun run notices:generate`.
Deliver with the [candidate-delivery skill](.agents/skills/candidate-delivery/SKILL.md).
Use the adapted `world-openspec-*` skills for OpenSpec work; see the
[skill guide](docs/agent-development.md#openspec-skills). These names survive CLI updates.

## Output bounds

Bound long output while preserving status: `set -o pipefail; … 2>&1 | tail -80`.
Lane logs: `.agents/delivery/lanes/`; on failure rerun only the failing stage.
Search scoped code paths with `rg -m 5 --max-columns 300 --max-columns-preview`; do not limit matches when searching docs.

## Waiting

Wait on a running command until it exits; never poll `gh` or `ps` in short loops.

## Verification

Changing a contract owner in `verification/coverage/`, a Quint model, adapter or consumer test requires the full verification gate; `--case` alone does not count. Mechanical edits explain in the PR why no contract is affected. Details: [verification](verification/README.md).

## Pointers

[CONTRIBUTING.md](CONTRIBUTING.md): gate selection/CI matrix;
[verification](verification/README.md); [releases](docs/release.md);
[UPSTREAM.md](UPSTREAM.md); [agent development](docs/agent-development.md): asks and visible teams.
