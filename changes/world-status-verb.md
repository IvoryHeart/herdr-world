### Added

- `herdr-world status KEY "line"` lets any program, with or without an LLM,
  report progress as a row in a new **Work** strip in Town's Summary, grouped
  by `--group`, with state, phase, progress, link and age. Rows interrupt
  nobody; `--needs-you` raises one Needs you question until the flag or the
  row goes. Rows turn stale after `--ttl` and drop off a day later.
  `status clear KEY` and `status ls` manage them.

### Changed

- The World CLI says "World isn't running" when it cannot reach the service.
