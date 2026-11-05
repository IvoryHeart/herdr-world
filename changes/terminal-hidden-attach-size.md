### Fixed

- Opening World, or an agent's window on Chat, no longer resizes the agents'
  terminals for every other viewer. A terminal World keeps hidden attached to
  a pane at 13×1 and shrank it to a sliver, and World's popup watcher shrank
  every pane to 80×24. Both now attach at the size the session already has,
  so harness menus such as Claude Code's or Codex's `/model` draw normally and
  Chat can read them.
- A terminal another client squeezed (for example an older World page) is
  never kept that small by World: a hidden terminal uses its last good size
  instead, and showing or clicking the Terminal view gives the agent its full
  size back.
