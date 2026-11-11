### Added

- Open a herdr-core agent's Files and Changes. They follow the folder its
  program runs in, through World's own file and Git tools on the core's
  host; a program replaced at that address, even one reusing its pid, has to
  be picked again. Downloads, uploads and Git actions work as for Herdr
  agents.
- Create, open and remove Git worktrees from a core room. A worktree becomes
  one of World's rooms of that core, and agents started there run in it. The
  repository's worktree location, worktree commands and Paseo hooks apply.
  Removing one first names every terminal that ends with it and ends nothing
  else; a failed teardown hook ends and removes nothing.
- `herdr-world ask` from inside a core agent is a verified caller: the
  question names that agent and waits at its desk. `--wait` and `ask get`
  return the answer. Without a CLI acknowledgement, core's native send
  delivers it to the original program and foreground; lost replies remain
  uncertain and never replay automatically.
- Ranger reads core rooms like workspaces: status, Git changes and an
  agent's visible screen. It can create a worktree from a core room, and
  send previewed prompts through core, and explain which lifecycle controls
  belong in World.
