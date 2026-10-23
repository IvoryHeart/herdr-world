## Why

The owner wants to configure agents (name, brain, skills, tools, a brief and a
Town look) and launch them from World, and starting a chosen agent from World
was broken: a new tab stayed a plain shell (#219). Herdr refused `agent.start`
until the new shell reached its prompt, and Board gave Herdr agent names it
does not accept, while the launch path treated those refusals as "may have
started".

## What Changes

- Agent profiles kept by the World service, with editable starters, mapped at
  launch to each harness's own configuration (a Claude Code subagent
  definition; Codex options and developer instructions).
- One launcher for Town, Spaces and Board: kinds discovered from the host's
  Herdr, a valid unique agent name, a bounded retry of refused starts, early
  reports of an exit or a question, the first prompt once ready.
- Harness readiness from each harness's own status command, and Log in through
  its own login command in a small tab.
- A profile editor and Town character creator with a live preview.

## Capabilities

### Modified Capabilities

- `world-surfaces`: Board's note start uses the shared launcher; new
  requirements for agent profiles, New agent and harness readiness.

## Impact

Service: `server/src/agent/` (profiles, launcher, readiness, skills) and new
connection RPCs `launcher.catalog`, `launcher.readiness`, `launcher.start`,
`launcher.login`, plus World RPCs `world.profiles.get|save|delete`.
`board.start_agent` is replaced by `launcher.start`. Browser: launcher and
editor dialogs, Town and Spaces entry points, Board's New tab dialog and Town's
sprites. Follow-ups: a `herdr-world profile` CLI and recording `spawned-by`
once the teams CLI and relations land.
