# Evidence: where the harnesses keep a folder's conversation

Read-only census on one Linux machine, 2026-11-23. Nothing was opened, started or
typed into. Versions: Claude Code 2.1.330, Codex CLI 0.171.0, Herdr 0.9.5 and the
herdr-core build then running. Counts only; no IDs, paths or names are recorded.
`<config>` is `${CLAUDE_CONFIG_DIR:-~/.claude}`; `<codex>` is `${CODEX_HOME:-~/.codex}`.

## Claude Code

| What | Where |
| --- | --- |
| The conversation a live process runs now | `<config>/sessions/<pid>.json`: `sessionId`, `cwd`, `procStart`, `kind`, `status` and more |
| The conversation's transcript | `<config>/projects/<cwd, every non-alphanumeric character as "-">/<sessionId>.jsonl` |

- The record is per process, so the folder never has to be guessed from. The
  existing reader (`server/src/agent/claude-process-session.ts`) already fences it
  with the process start time against pid reuse, and its comment says Claude
  rewrites `sessionId` on `/clear` and `/resume`.
- Herdr TUI: 2 of 2 Claude panes reported a session through Herdr's hook
  (`source: herdr:claude`). Both matched the process record's `sessionId` and
  `cwd`, and both transcripts existed.
- herdr-core: 18 of 18 Claude terminals had a process record.
- A Claude process held no file under `<config>` open, so the configuration folder
  cannot be read from open files. It comes from the process's `CLAUDE_CONFIG_DIR`
  (one variable, filtered on the host), falling back to `~/.claude`.

## Codex

| What | Where |
| --- | --- |
| The thread a live process owns | An open file descriptor on `<codex>/thread-writer-locks/<thread-id>.lock`, held for the life of the thread |
| The thread's row, after its first turn | `<codex>/state_5.sqlite`, table `threads(id, rollout_path, cwd, source, title, …)` |
| Sub-agent threads | `thread_spawn_edges(parent_thread_id, child_thread_id)` in the same database |
| The transcript, after its first turn | `<codex>/sessions/YYYY/MM/DD/rollout-<time>-<thread-id>.jsonl` (also `threads.rollout_path`) |
| Turn index | `<codex>/thread_history_1.sqlite`, table `thread_turns(thread_id, …)` |
| Names | `<codex>/session_index.jsonl`: `id`, `thread_name`, `updated_at` |

- Every live Codex process held exactly one non-sub-agent thread lock:
  7 of 7 on Herdr TUI and 6 of 6 on herdr-core. One process also held a second lock
  for a sub-agent thread, listed in `thread_spawn_edges`.
- Where a thread row existed, its `cwd` equalled the process's folder and its
  rollout file name contained the thread ID.

| Runtime | Codex processes | Herdr reported a session | Thread has turns (rollout open) | Thread empty (no row, rollout or turns) |
| --- | --- | --- | --- | --- |
| Herdr TUI | 7 | 1, equal to the lock | 1 | 6 |
| herdr-core | 6 | — | 3 | 3 |

- **Why World found no conversation for most Codex agents.** World's process reader
  (`server/src/agent/process-transcript.ts`) looks only for an open rollout file.
  Every process whose thread had turns held its rollout open, so the reader can
  find those. The 9 empty threads have no file to find, and the reader never looks
  at the lock, so it says "unknown" where the truth is "known, and empty". An
  empty thread has nothing to continue.
- The lock's full path names `<codex>`, so Codex's home needs no environment read.

## Finding the process

| Runtime | Foreground process of a pane or terminal |
| --- | --- |
| Herdr TUI 0.9.5 | `herdr pane process-info --pane <id>`: `foreground_processes[].pid` and `argv` |
| herdr-core | the terminal's `foreground: {pid, argv, cwd, name}` |

On other hosts, the same reads run over the connection's existing SSH read path.

## Not checked here

These need an isolated Herdr session and scratch harness homes (task 2.4):
- that Codex moves its lock to a new thread on `/new` and `/resume`;
- that Claude rewrites its record on `/clear` (today this comes only from a code comment);
- macOS (`lsof` for open files, `ps` for the start time).
