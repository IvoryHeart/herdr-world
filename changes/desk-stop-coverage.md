### Fixed

- Keep a reviewable stop for agents already finished when World first sees them,
  and retain it after the 12-hour display window expires. Current stops no longer
  disappear at 500 agents; bounded history yields before current metadata.
- Prevent unknown-session Desk reviews from following a replacement agent or
  inheriting unproven ownership after restart. Known sessions restore their exact
  reviewed stop after fresh verification.
