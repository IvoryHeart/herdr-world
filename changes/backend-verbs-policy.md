### Changed

- Validate browser and agent commands through a service-owned verb registry while
  preserving existing permissions, acknowledgement flags and confirmation flows.
  Unknown browser methods are refused before contacting Herdr, and command replies
  include evidence of admission, durable storage or native dispatch when available.

### Fixed

- Recheck CLI authorization when held or queued work reaches dispatch, so stopping
  the CLI service prevents later native sends and World writes even while its host
  remains connected. Classify page-key input and file-manager launches as opaque
  effects, and PR/link lookups as reads.
