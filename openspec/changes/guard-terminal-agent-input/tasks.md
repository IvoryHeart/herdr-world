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

## Follow-up #1447 (owner scope: peek replies and review prefill only)

- [x] 3.1 Route the shared Town/Board peek sender and review prefill through the foreground guard without changing key/Enter behavior or direct Terminal authority.
- [x] 3.2 Offer Not sent with Copy, retain refused review drafts and add a safe preview refusal switch.
- [x] 3.3 Pass caller/service and desktop/phone recovery regressions and quick typecheck; update contracts and consumer mappings. The full verification gate remains a delivery requirement.

## Follow-up #1451 (saved answers across a World restart)

- [x] 4.1 Prove the original harness session after a World restart on Herdr TUI and herdr-core at recording, dispatch and input; refuse everything else with a plain reason. Core proof is the session Claude's own live process record names now, saved with the question; PIDs, names and launch arguments never count.
- [x] 4.2 Keep possible sends uncertain without automatic replay; an explicit Send again reaches only a proven session.
- [x] 4.3 Pass restart/session matrices on both runtimes, a desktop and phone Reception > Outbox fixture and quick typecheck; update contracts, help and consumer mappings.
