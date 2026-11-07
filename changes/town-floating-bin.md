### Changed

- The bin at the bottom of Town and Board lights up while an agent is dragged,
  so a phone can drop an agent on it with a short drag wherever Town is
  scrolled, and Town no longer scrolls while the drag rests on it.
- Only Town's bin speaks of the bus: on Board and other views it reads
  "Cleaning up" with the count, and its tray says when they close.
- While an agent waits for the bus in Town, its seat fades into the carpet
  and crumbles, so the desk reads as going; a desk whose agents are all
  binned fades whole. Putting the agent back clears it.
- An agent put in the bin on Board walks out of its front door to its stop
  the first time Town shows it, instead of already standing there.

### Fixed

- A Town bus stop's countdown now runs to the bus reaching that stop and reads
  "due" only a few seconds before it pulls in, instead of from the trip's start.
- An agent put in the bin in Town walks out of its front door and along the
  pavement to its stop on a phone too, instead of appearing at the stop when
  its walk indoors took longer than 15 seconds.
