### Changed

- Town rooms extend to fit: a room grows to its screen's width (eight tables
  on wide screens, six on portrait and half-width ones, four on phones) and
  then adds rows, up to 127 tables, so a room of agents spawning agents shows
  every table (rooms used to stop at 19, hiding the newest tabs). A room with
  even more keeps its three newest and busiest tables and hides idle ones
  first.
- Town lays out buildings for its container: one column of rooms on phones,
  two on portrait and half-width screens, three on wide ones. A growing room
  moves only the rooms below it, waits while you hold, scroll or zoom the
  town, and keeps the room you are looking at in place. Zooming into a very
  large room, from its card or with Zoom in, opens at its first tables.
