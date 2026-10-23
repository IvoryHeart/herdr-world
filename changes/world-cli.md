### Added

- Agents can change World themselves with the `herdr-world` CLI;
  `herdr-world --skill` prints the agent guide. Agents colour, pin, move and
  group Board cards, reorder Town desks (`--herdr`, through Herdr's tab
  order), stamp their own spawn (`spawned-by`), report task results
  (`result`) and ask the owner questions (`ask … --wait`), which appear first
  in Town's **Needs you** list for an answer. World checks that a caller runs
  in the pane it names, records every change with its actor and time
  (`history`), and can undo World-side changes (`undo`). JSON output when
  piped and stable exit codes.
