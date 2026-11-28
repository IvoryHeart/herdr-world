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

## Preview refusal repair #1447

- [x] 4.1 Capture the refusal switch in the eager browser entry before any routing or lazy view initialization, retaining it across navigation without persistence.
- [x] 4.2 Exercise the real `/?agentInputGuard=refused` entry through `/town` in Chromium and require refusal with zero runtime sends for replies, answer keys and review prefill.
- [x] 4.3 Correct usage notes and owner Try steps to disclose real agents and use the root URL.
