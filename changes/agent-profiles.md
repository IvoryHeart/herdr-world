### Added

- Agent profiles: name, home room, role, colour, harness and model, Codex
  reasoning effort, permission mode, skills, tools, a starting brief and a
  Town look (skin, hair, outfit including a dress, colours and an accessory)
  with a live preview. Reviewer, Builder, Designer and FirstMate are editable
  starters. Open them from Menu → Agent profiles, Town's toolbar, the launcher
  or Board.
- **New agent** in Town (toolbar and each room's plaque, also on phones),
  Spaces (beside **+**) and Board starts an agent in a new tab from a profile in
  one tap, or any agent kind the host's Herdr supports. A profile becomes the
  harness's own configuration at launch (a Claude Code subagent definition, or
  Codex options and developer instructions), the tab takes its colour and the
  agent wears its look in Town.
- The launcher shows whether each harness is installed and logged in, using the
  harness's own status command, and **Log in** opens its own login command in a
  small tab. World never sees or stores credentials.

### Fixed

- Starting Claude or Codex from Board, or any new agent, no longer leaves a
  plain shell: World waits for the new tab's shell before starting the agent,
  gives the agent a name Herdr accepts, and reports at once when the harness
  exits or stops on a question (#219).
