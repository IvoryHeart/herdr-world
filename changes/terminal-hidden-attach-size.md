### Fixed

- Opening World, or an agent's window on Chat, no longer resizes the agents'
  terminals for every other viewer. A terminal World keeps hidden attached to
  a pane at 13×1 and shrank it to a sliver, and World's popup watcher shrank
  every pane to 80×24. Both now attach at the size the session already has,
  so harness menus such as Claude Code's or Codex's `/model` draw normally and
  Chat can read them.
