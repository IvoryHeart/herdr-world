### Added

- Open Town with `?scene=town-scale` to see a synthetic town at full scale: 3
  hosts, 24 rooms, 312 desks and 291 agents in every state. The report
  `docs/design/town-at-scale.md` shows how it reads at each zoom.

### Changed

- Town's room cards keep the room's full name at town zoom. The busy count
  comes before the desk count, and the waiting badge sits beside the status
  bar.
- A reception chip for an agent with no Herdr name shows the agent's room
  instead of its harness. Its tooltip names the room and desk.
