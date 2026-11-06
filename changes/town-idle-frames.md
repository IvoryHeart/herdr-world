### Fixed

- Stop Town from redrawing covered or off-screen ambient animation. Visible
  motion keeps its smooth cadence, and static scenes wake when their state changes.
- Repaint a sleeping Town after GPU context restoration, including when returning
  from a hidden page.
