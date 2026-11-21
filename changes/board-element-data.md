### Added

- Add a typed Board element registry and CLI/API for durable memory-file,
  saved log/transcript, document and link references with bounded source reads.
  Board presentation follows separately.

### Fixed

- Preserve main's Apartments migration versions and recover early Board-only
  schema-14 previews without losing saved elements or other records.
- Expose each connection's current generation in `herdr-world ls --json` so
  agents can discover the selectors needed to read project-backed Board elements.
