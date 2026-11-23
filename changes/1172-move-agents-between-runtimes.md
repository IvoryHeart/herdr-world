### Changed

- Move an agent between Herdr TUI and herdr-core: drag its desk into the other
  runtime's room, or use **Move to…** on its Town or Board peek or Town's **M**
  chooser. It resumes its conversation there and keeps its colour, pin and
  spawn lines; a busy agent is refused with the reason. A plain terminal, or
  an agent whose conversation World can't find, moves after you confirm: it
  starts fresh there in the same folder. A Codex agent closes first and then
  resumes there; if it doesn't start, it resumes back where it was. A refused
  move says why, and the service logs every step of a move.

### Fixed

- Setting a colour on a herdr-core desk no longer fails with "unknown
  connection".
- A herdr-core agent's window no longer shows as stale while the Herdr TUI
  session is disconnected.
- A Codex agent on herdr-core now resumes its conversation when it moves to
  Herdr TUI, and Apartments keep its session, instead of World saying it
  can't find the conversation.
- A pinned desk moved to herdr-core can move again, to another core room or
  back to Herdr TUI. A pinned desk now moves to any other room it can go to
  and stays pinned there; within its room it still takes only pinned seats.
- Move to… on a Board card no longer offers the same Herdr's rooms as
  "another runtime"; moves between two connections of one Herdr are Herdr's
  own, and nothing restarts.
- A herdr-core desk moved to another core room keeps its Board colour, pin
  and links.
- Moving an agent again before its last move settles is refused instead of
  racing the first move.
