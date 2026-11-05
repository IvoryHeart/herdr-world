### Added

- Close agents with a bin: drop an agent in it and it closes when its countdown
  ends (30 seconds by default; 10 s, 1 min or 2 min in Settings), unless you
  take it back first. Town's bin has London bus stops at its crossings, where a
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
- Use one held tray in Town, Board and Desk with a visible Resume control after
  switching views; a normal tap or click on the bus opens it on phones too.
- Make Town's Bus stop chip an easy phone drop target: it moves near the top
  of the screen while you carry an agent, grows under your finger, is named in
  the carry hint, and the town no longer edge-pans beside it. Tapping the stop
  or its chip opens the bin tray, and a bus emptied by Put back drives away
  instead of vanishing. The tray shows its held state and the shared wait.
- Put a bus stop at every crossing in Town: an agent waits at the stop nearest
  its room, the one bus calls only at stops with riders in road order at a
  speed fixed when it sets off, and tapping any stop opens the tray, which
  names each agent's stop.
- Keep the bus-stop chip aimed at the departure whose clock it shows when
  trips overlap. Late riders joining during the final brake board at that stop;
  if every earlier rider is put back, the bus returns with them to their own stop.
