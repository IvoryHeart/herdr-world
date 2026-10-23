### Fixed

- Chat in an agent's window no longer runs past the window: the conversation
  scrolls inside it and the composer stays at the bottom, docked or floating,
  on phones and on large screens. Reopening, docking or undocking the window
  keeps the conversation instead of showing it empty.
- Chat stays responsive on long, busy transcripts. It now shows History's
  window (bubbles and collapsed tool cards that load their text when opened)
  and reads only what changed on each update, instead of rereading and
  redrawing the whole conversation.
- The Town master setting finds an agent by its Herdr name (`herdr agent
  rename`), not only by the label Town shows.
