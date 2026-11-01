### Added

- Close agents with a bin: drop an agent in it and it closes when its countdown
  ends (30 seconds by default; 10 s, 1 min or 2 min in Settings), unless you
  take it back first. Town's bin is a London bus stop on the top road, where a
  red double-decker drives in, sounds its horn at the stop and collects the
  agents waiting there (a drop from Board, Desk or Town restarts the shared
  countdown for everyone on it, while the bus keeps its original approach
  speed and waits longer at the stop); when the countdown ends it drives away, and you can still
  stop it until it leaves the map. Nothing is
  closed before then or before you choose Close now, and a World restart cancels
  every countdown without closing anything.

### Fixed

- Keep room-floor drops beside the bus chip as room moves. The chip accepts
  drops within its visible touch target instead of capturing nearby floor.
- Keep a pinned tab's last pane while a sibling close is pending, preserve the
  bus's trip progress after reloading, and wire Desk cards and Close agent…
  actions to the shared bin.
- Keep the whole bus-stop chip clear of the held-bus panel, including while
  carrying an agent on a phone.
