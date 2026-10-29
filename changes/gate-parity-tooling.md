### Fixed

- Catch file-size ratchet ceilings lowered on main before pushing, and validate
  PR descriptions locally with `bun run check:pr-body <file>`.

### Changed

- Run static checks and affected unit tests for PRs limited to agent tooling and
  its runbooks, while keeping Delivery checks and protected platform reports.
