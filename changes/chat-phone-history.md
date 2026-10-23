### Added

- **Chat text** in Configuration sets Chat's text size. It follows the
  terminal font size until set on its own, and Chat's text is a step larger
  than before (13px).
- Chat loads earlier messages as you scroll back past the latest 200, a page
  at a time, keeping your place; **Load earlier messages** does the same.

### Changed

- Town's hover card no longer has an **Inspector** button: **Open chat** and
  **Open terminal** open the agent's window, whose Files and Changes views
  hold the rest.
- In Chat's composer, Enter starts a new line, as in the terminal composer;
  **Send** or `Ctrl+Enter` (`Cmd+Enter` on a Mac) sends.

### Fixed

- Repeated scrolling while an earlier Chat page is loading keeps one request
  in flight, including when new messages move the recent-history window.
- A docked Chat window restored on page load, for an agent on a host the page
  had not opened yet, no longer stays blank until the agent is clicked, even
  when the connection comes up after the window mounts.
- Chat no longer runs off the right edge on phones: a long path, command,
  link or title wraps or scrolls inside its own bubble, and wide tables
  scroll instead of squeezing every cell to one letter a line.
- A message sent from Chat with an attachment is no longer left as "Sent; not
  yet seen" when Claude Code records the image as `[Image #N]`.
- A message sent from Chat over several lines no longer stays "Sent; not yet
  seen" or shows twice with its `pasted_content` tags: Chat reads Claude
  Code's paste wrapper and shows the words marked **Pasted**. When the harness
  rewrites a send, only a compatible later turn can match it by order; an
  unrelated prompt from another client leaves the send waiting.
- A sent message waiting for a busy agent sits at its send time as
  "Delivered · waiting for <agent>", never below replies written since.
- A loop the agent scheduled once (`ScheduleWakeup`) no longer shows as in
  progress after its wake-up has run and no further one was scheduled.
- An agent's window header shows the name given with `herdr agent rename`
  instead of the harness name, as Board and Desk do.
- Chat's message bubbles keep to about 75 characters a line in wide windows.
