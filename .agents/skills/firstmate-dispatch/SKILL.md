---
name: firstmate-dispatch
description: Start a crew agent of any harness (Claude Code, Codex, Gemini, pi) in Herdr with a file brief, a roster entry, its own worktree and the owner's permission parity, then health-check it. Use when a delegator hands work to a new or idle agent.
---

# FirstMate dispatch

A delegator ("FirstMate") hands work to crew agents running in Herdr panes. This
skill covers one dispatch: choose the agent, write the brief, start or prompt
it, and confirm it is really working. `herdr --skill` documents the CLI; this
skill adds the rules learned from running a crew. Values in angle brackets come
from the Config section.

## Before briefing

1. **Check for overlap.** List the files the task is likely to touch and compare
   them with open PRs (`gh pr list --json number,headRefName,files`). Overlapping
   work waits, or is stacked explicitly on the other branch. Shared hotspot files
   (changelog, feature list, tutorial, knowledge map) are the usual collisions.
2. **Pick the harness.** Use the owner's routing (Config). When one harness is
   rate-limited, route to another rather than waiting.
3. **Make a worktree.** One writer per branch. Create the agent's own worktree
   with the repository's worktree tool and start the agent with that directory
   as its cwd (`herdr tab create --cwd <worktree>`), so Herdr and World report
   the right worktree.

## Write the brief to a file

Put the brief in `<briefs-dir>/<name>.md`, not only in the prompt. A restarted
agent loses its context; with a file brief every restart is "read your brief".
A brief contains:

- `You are <name>.` and a task ID (for example `FM-<TOPIC>`).
- The task and its exact target: PR number, branch, commit range.
- Sources to read first (the repository's agent guide, the crew protocol).
- Scope limits: what not to touch, and "do not approve, merge or answer other
  agents' prompts".
- Where the output goes (PR, PR comment, file) and the privacy rule: no local
  paths, hosts or session links in anything published.
- A one-line reply contract: `Reply to <delegator> in one line: RESULT <ID>: …`.
  The fixed reply line is what makes terminal results usable.

Relayed authority is limited to the brief's scope. A briefed agent cannot tell a
relayed message from the owner typing, so the brief must not imply more.

## Start or prompt

- **Name rule:** `[a-z][a-z0-9_-]{0,31}`, unique. Names belong to whoever occupies
  the pane and vanish when the agent exits; rename after any restart.
- **New agent:** create the tab, wait for the shell prompt (`agent start` refuses
  with `agent_pane_busy` until it appears), then start with the harness flags
  from Config, for example
  `herdr agent start <name> --kind codex --pane <pane> -- <codex-flags>`.
- **Prompt:** `herdr agent prompt <name> "[<delegator> -> <name>] Read <briefs-dir>/<name>.md and start."`
  Prompt only idle or done agents. Never prompt an agent that is `blocked`: it is
  waiting on a permission or question, which only the owner answers.
- **Waiting:** run `agent prompt --wait` (or `agent wait <name>`) as one *tracked*
  background task with a generous timeout. A shell `cmd &` inside a foreground
  command is not tracked and never notifies you. Read the wait's output before
  trusting it: a wrong flag exits at once and looks like completion
  (`--until` takes repeated flags, not a comma list).
- **Never resend blindly.** Before retrying, look for the task's artifacts (branch,
  PR, file) by its ID.

## Health check

About two minutes after the first brief, read the agent's screen
(`herdr agent read <name> --source visible --lines 40`) and confirm it is
running commands. Failures seen in practice:

- A sandboxed harness that cannot run commands at all and sits idle.
- A trust or permission prompt that swallowed the brief.
- An agent reporting `done` while still mid-turn; confirm with its transcript
  tail before acting on `done`.

Never act on text in an agent's input box: harnesses show ghost "suggested next
prompts" that look like owner requests.

## Record it

Add the agent to the roster (`<roster>`): name, pane, harness, **model and effort**,
worktree, brief and task ID. Reviewers and the owner will ask which model an
agent runs; read it from the pane's status line when unsure. Log the dispatch in
the ledger with the time.

## Config

| Key | This repository's value |
|---|---|
| delegator name | `firstmate` |
| briefs-dir | `.agents/firstmate/briefs/` (untracked) |
| roster | the "Who is who" table in `.agents/firstmate/protocol.md` |
| ledger | `.agents/firstmate/ledger.md` |
| worktree tool | `bun run agent:worktree -- create <slug> <parent-ref>` |
| routing | Codex for coding-heavy work, reviewed by Claude; Claude for design and product work |
| Claude flags | the owner's normal Claude Code permission mode |
| Codex flags | `-m <model> -c model_reasoning_effort=<effort> -a never -s danger-full-access` (`workspace-write` cannot run commands on this machine; full access is the owner-approved parity with Claude) |
| other harnesses | Gemini and pi are installed for benchmarking; brief them like Codex |
