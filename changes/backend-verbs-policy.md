### Changed

- Validate browser and agent commands through a service-owned verb registry while
  preserving existing permissions, acknowledgement flags and confirmation flows.
  Unknown browser methods are refused before contacting Herdr, and command replies
  include evidence of admission, durable storage or native dispatch when available.
