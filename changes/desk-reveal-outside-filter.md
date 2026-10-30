### Added

- Expand a Desk host summary to reveal and open an agent outside the Hosts filter,
  with the destination host named explicitly and existing Inspectors preserved.
  Host controls stay visible beside a reading pane and wrap below the counts
  on phones. Cached, unavailable or replaced agents explain why they cannot open.

### Fixed

- Cancel pending Desk reveals permanently when leaving the view, unmounting or
  starting a newer reveal, including queued Inspector admission. Superseded
  requests leave current agents available to retry without an unavailable error.
