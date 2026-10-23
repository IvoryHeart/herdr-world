---
name: firstmate-daily-briefing
description: Produce the owner's daily brief (crew status, PRs, merges, open questions, machine) with a deterministic script, and commission the daily upstream report. Use at the start of the owner's day, after a long pause, or when the owner asks where things stand.
---

# FirstMate daily briefing

The brief is built from facts, not from memory: a script reads Herdr, GitHub and
the questions file and prints Markdown. The delegator adds only what the script
cannot know (decisions waiting on the owner, risks), in a few lines at the top.

## Run the brief

```bash
python3 .agents/skills/firstmate-daily-briefing/brief.py \
  --repo <repo> --crew <crew> --questions <questions> --disk <home-fs> \
  > <briefing-dir>/<YYYY-MM-DD>.md
```

It prints:

- **Crew:** each agent's Herdr state and its last message. For Claude Code agents
  it reads the last assistant text from the transcript; for others it falls back
  to the last non-chrome line on screen (so treat those as hints).
- **Pull requests:** open PRs with draft, mergeable, CI and review count.
- **Merged in the last 24 h.**
- **Needs you:** unanswered owner questions and agents blocked on a prompt.
- **Machine:** free disk space.

Then, above the script output, write at most five lines: what needs the owner's
decision today, what is READY for them to merge (verified, see
firstmate-merge-queue), and anything red. Keep the brief local; it names agents
and work in progress. Show it to the owner as a page or file, and summarise it
in chat in two or three lines.

## Upstream report

Once a day, ask the upstream watcher (a read-only agent) for its report covering
changes since the last one:

```
[<delegator> -> <watcher>] Today's upstream report, since <last-date>.
Write <upstream-dir>/<YYYY-MM-DD>.md (headlines, per-source changes with impact,
proposed actions with owners, owner questions). Read only: propose, do not file.
Reply in one line: UPSTREAM REPORT <path> + headlines.
```

Fold its headlines and owner questions into the brief. Proposed actions become
ledger items or briefs only after the owner agrees.

## Config

| Key | This repository's value |
|---|---|
| repo | `IvoryHeart/herdr-world` |
| crew | omit to include every named agent, or pass the roster names |
| questions | `.agents/firstmate/questions.md` (table: `\| Qn \| question \| … \| status \|`) |
| home-fs | `/home` |
| briefing-dir | `.agents/firstmate/briefing/` |
| watcher | agent `upstream`; sources: Herdr, Roamgate (`UPSTREAM.md`), installed Herdr plugins, supported harness CLIs |
| upstream-dir | `.agents/firstmate/upstream/` |
