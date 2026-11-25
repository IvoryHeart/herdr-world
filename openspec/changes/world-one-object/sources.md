# Sources of record

Every source World reads, the facts it owns, how World learns them and how a change
gets back to it. For each: World derives, views display, changes go back through
World. Paths are under `server/src/` unless they start with `shared/` or `web/`.

"Owns" means the source decides the value. When World and a source disagree about a
fact the source owns, the source wins and World corrects itself at the next
observation. World never owns a copy of a runtime fact.

## 1. Runtimes

| Source | Facts it owns | How World learns them | Changes go back through |
|---|---|---|---|
| Herdr TUI | Workspaces (name, order, cwd), tabs (name, order), panes (cwd, layout, process), agent kind and status, `agent_session`, pane metadata tokens, focus | `workspace/tab/pane/agent.list` in `adapters/herdr-runtime.ts`, batched by `adapters/runtime-ports.ts`; event subscription in `connections/runtime.ts` (`DEFAULT_EVENTS`), agent status in `connections/agent-status-subscription.ts`; cached 15 s in `world/snapshot.ts` | Runtime verbs: rename, create, close, move, split, `launcher.start`; World verbs that call the runtime (`world.appearance.rename`, `town.move_desk`, worktree verbs) |
| herdr-core | Terminals (address, argv, pid, state, cwd), shared labels `herdr.seen` and `herdr.pinned`, World's own labels (`herdr-world.summary`, `herdr-world.spawned-by`) | Event stream with baseline and `missed` into `herdr-core/mirror.ts`; projected by `herdr-core/topology.ts` | `world.core.launch`, `world.core.kill`, `world.core.input`, `world.core.seen`, `world.core.favourite` |

Not owned by the runtime: profile assignment and Town Master are World's
(single-model decision). Pane tokens `world_profile` and `world_master` are mirrors
World writes. Core rooms and tabs (`core_topology`) are a World store, listed in §6.

Terminal input (keys, text, paste) and terminal output are terminal I/O, not facts.
They stay on the qualified terminal relay and are outside this design.

## 2. Git and forges

| Source | Facts it owns | How World learns them | Changes go back through |
|---|---|---|---|
| Repositories and worktrees (`git`, local or over SSH) | Branch, ahead/behind, status, diffs, commits, worktree list | Polled, 20 s cache (`workspace/status.ts`); on demand for diffs and history (`workspace/git-diff.ts`, `git-history.ts`); worktrees (`agent/worktree-git.ts`, `herdr-core/worktrees.ts`) | `git.file_action`, `git.repo_action`, `git.pull`, `worktree.*`, `world.core.worktree.*`; auto-sync (`workspace/auto-sync.ts`) |
| Pull requests (`gh`/`glab` per checkout) | PR, checks, review state for a branch | On demand (`workspace/pull-request.ts`) | Read only from views; merge/close/ready through `source:github.pull-request.*` |
| GitHub Sources (`gh api graphql`) | PRs to review or authored, assigned issues | 60 s (`sources/service.ts`) | `source:github.pull-request.*` verbs (`sources/actions.ts`) |
| Shipyard (`gh api`) | Default-branch head, releases, tags, workflow runs | 60 s, forced at most every 5 s (`shipyard/github.ts`) | Read only |

## 3. Harness files

| Source | Facts it owns | How World learns them | Changes go back through |
|---|---|---|---|
| Transcripts (Claude Code `projects/*.jsonl`, Codex `sessions/`, others) | Conversation content, turns, history, past sessions | File watches (`agent/conversation-watch.ts`, `agent/codex-session-watch.ts`); census every 15 min (`world/apartment-census.ts`) | Read only; eviction is a World record (`world.apartments.evict`) |
| Running-session records (Claude `sessions/<pid>.json`, Codex thread locks, `/proc`) | Which conversation a process is running | On demand (`agent/claude-process-session.ts`, `agent/process-transcript.ts`); the conversation claim in #1315 | Read only |
| Harness settings, status line, skills, memory files | Status line, installed skills, memory and rules files | On demand (`usage/claude-tap.ts`, `agent/skills.ts`, `memory/adapters.ts`) | `world.integration.install`, `world.memory.*` |
| Usage (transcripts, status-line tap, Prometheus) | Tokens, context, cost, plan limits | Collected every 20 s (`usage/service.ts`); Prometheus every 30 s (`world/observability.ts`) | Read only |
| Harness binaries and login | Installed, logged in | On demand (`agent/harness-readiness.ts`) | `launcher.login` |

## 4. Deployments

| Source | Facts it owns | How World learns them | Changes go back through |
|---|---|---|---|
| Instance registry (`<data>/instances/*.json`) | Other local World instances, peer asks | Leases renewed every 15 s; peer asks every 5 s (`shipyard/instances.ts`, `world/ask-peers.ts`) | Each instance writes only its own entry |
| World and Herdr releases | Newer versions | On check (`http/update.ts`, `herdr/release.ts`) | Install routes (security-sensitive, unchanged) |

## 5. Integrations

| Source | Facts it owns | How World learns them | Changes go back through |
|---|---|---|---|
| Integration registry | Row state per runtime, harness, source, metric and vault | Aggregated on request (`integrations/registry.ts`) | Each row acts through its owner, never the registry |
| Jira | Assigned tickets | 60 s (`sources/jira.ts`) | Settings route; token in the Vault |
| Vault (`source-secrets*.json`) | Secrets | On use (`integrations/vault.ts`) | Vault writes only; status is all a view sees |
| Weather | Weather | 15 min (`weather/provider.ts`) | Read only |

## 6. World's own stores

World is the source of record for these. The catalog in `storage/catalog.ts` lists
each table, file and browser key with its owner, identity and limit. For these facts a
committed write is the observation: World's value changes when the store commits.

| Store | Facts |
|---|---|
| `world.sqlite` | Board document (notes, strings, shapes, layout, card placement), colours and appearance, desk pins and rank, interest, groups, spawn claims, profiles and assignments, Town Master, chimes, asks and results, outbox and effects, identities and bindings, terminal marks, apartments, `core_topology`, and the agent and place records of #1315 |
| `settings.json` | Repository and worktree settings, auto-sync, terminal transport, UI settings such as `ui.runtimeGrouping` |
| `connections.json` | Connection and host profiles |
| Browser keys | Listed in the catalog. Some hold World facts today (pins, agent order, PR summaries); [audit.md](audit.md) lists them and [tasks.md](tasks.md) moves them |

## 7. Other files and processes

| Source | Facts it owns | Notes |
|---|---|---|
| Workspace files | Directory listings and contents | Read on demand; `file.*` and upload routes write them |
| `/proc`, `ps`, `lsof` | Process start times, open files, cwd holders | Evidence only, never shown as a fact by itself |
| OpenSSH config | Host aliases and keys | Not parsed by World; `ssh` reads it |
| Environment (`HERDR_WORLD_*`, `HERDR_*`) | Paths, ports, sockets | Configuration, not World state |
| Browser heartbeats | Last time someone looked at World | `world.presence.seen` |

## What is not a World fact

Per-browser presentation stays in the browser and is not part of the World object:
camera, zoom, scroll, selection, open windows and panels, collapsed sections, drafts
being typed, and per-browser themes. The test: if another view, another browser or the
CLI must agree on it, it is a fact and belongs in World.
