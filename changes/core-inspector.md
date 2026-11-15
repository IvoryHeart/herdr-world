### Changed

- A herdr-core agent opens in the same Inspector window as a Herdr agent, with
  Chat, Terminal, Files and Changes tabs, from Town, Board, Desk, Needs you and
  Open chat. Its terminal is the Terminal tab; the separate terminal window is
  gone.
- While its window is open, World keeps the core terminal at the size that fits
  the window, through blur and idle; resizing the window resizes the terminal,
  and closing it gives the size back. A Herdr app that has the terminal open
  keeps its own size.

### Fixed

- Open chat on a core agent in Town now opens its Chat.
- The first click or key in a core terminal focuses it, shows the cursor and
  sends the key once.
