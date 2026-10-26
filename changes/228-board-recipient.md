### Fixed

- Board Send asks again if a previously captured agent session disappears,
  even when the pane, terminal and foreground process group stay the same.
  Session loss during submission is reported as uncertain delivery instead
  of success; inspect the pane before sending again.
