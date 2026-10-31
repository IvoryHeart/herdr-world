### Changed

- Validate browser and agent commands through a service-owned verb registry while
  preserving existing permissions, acknowledgement flags and confirmation flows.
  Unknown browser methods are refused before contacting Herdr, and command replies
  include evidence of admission, durable storage or native dispatch when available.

### Fixed

- Recheck CLI authorization when held or queued work reaches dispatch, so stopping
  the CLI service prevents new effects even while its host remains connected.
  Finish history/undo records for effects already applied, and restore a Board
  edit after a rejected history write only if no newer edit superseded it.
  Classify page-key input and file-manager launches as opaque
  effects, and PR/link lookups as reads.
