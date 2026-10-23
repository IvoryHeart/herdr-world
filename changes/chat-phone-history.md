### Added

- Chat loads earlier messages as you scroll back past the latest 200, a page
  at a time, keeping your place; **Load earlier messages** does the same.

### Fixed

- Chat no longer runs off the right edge on phones: a long path, command,
  link or title wraps or scrolls inside its own bubble, and wide tables
  scroll instead of squeezing every cell to one letter a line.
- A message sent from Chat with an attachment is no longer left as "Sent; not
  yet seen" when Claude Code records the image as `[Image #N]`.
- A sent message the conversation has moved past no longer sits below newer
  replies: after a minute it shows where it was sent, as "Sent · delivery
  unknown".
- A loop the agent scheduled once (`ScheduleWakeup`) no longer shows as in
  progress after its wake-up has run and no further one was scheduled.
- An agent's window header shows the name given with `herdr agent rename`
  instead of the harness name, as Board and Desk do.
- Chat's message bubbles keep to about 75 characters a line in wide windows.
