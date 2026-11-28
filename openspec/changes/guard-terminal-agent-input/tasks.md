## Implementation (2026-11-28 owner simplification supersedes earlier designs)

- [x] 1.1 Use one shared foreground leader basename policy, ignoring arguments and children.
- [x] 1.2 Apply it at TUI and core input boundaries; remove tty-reader code and input-specific /proc probing.
- [x] 1.3 Preserve pre-PR behavior when runtime foreground information is missing.
- [x] 1.4 Keep terminal/runtime qualification, raw Terminal authority and no-replay recovery.
- [x] 1.5 Retain authoritative Not sent reasons and copy/get/composer recovery.
- [x] 2.1 Align help, active deltas, capability notes and verification mappings; document inside-harness shells and missing information.
- [x] 2.2 Pass shell-exit/retrieval tests on both runtimes, basename/children/fallback matrices and quick typecheck.
- [x] 2.3 Pass full verification gate; format, inspect, commit and validate exact PR body.
- [x] 2.4 Push crew branch and hand off without CI polling or merging.
