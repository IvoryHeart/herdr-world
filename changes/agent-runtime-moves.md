### Added

- Move an idle Claude or Codex conversation between connected Unix runtimes or
  hosts from Agent settings, keeping pins, colours, desk placement and spawned-by
  links. World prepares both shells before quitting, and safely rolls back a
  failed resume in the original tab.
  Source launch settings (model, permission/approval mode, sandbox and Claude
  custom agents) follow both the move and rollback; unreadable or ambiguous
  launch commands refuse before quitting.
- Re-attach remaining saved desk details after a manual move with
  `herdr-world agent reattach`.

### Fixed

- Move a single-agent Town desk TUI → core, core → TUI or between core rooms
  through the conversation handoff. Offer other rooms on the current runtime
  in Move to, and resolve core desk colour edits through their core connection.
