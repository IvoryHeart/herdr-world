### Added

- Add a typed Board element registry and CLI/API for durable memory-file,
  saved log/transcript, document and link references with bounded source reads.
  Board presentation follows separately.

### Fixed

- Expose each connection's current generation in `herdr-world ls --json` so
  agents can discover the selectors needed to read project-backed Board elements.
