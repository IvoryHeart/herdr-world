## ADDED Requirements

### Requirement: Started harness readiness

World SHALL show an agent on herdr-core as idle while its harness reports
`idle`, if that harness ends a turn that has a result with `done` (Claude
Code and Codex), whatever its turn and `herdr.seen` hold, and SHALL NOT push a
"completed" alert when such a harness goes from busy to `idle`. Other
harnesses SHALL keep Herdr's rule: an idle turn above the shared seen turn is
done. Through World's launch wrapper the desk SHALL name the harness from the
first observed event.

#### Scenario: Codex starts on core

- **WHEN** World starts Codex on herdr-core with `herdr.seen=0` and Codex
  reports `working` for a moment while starting, then `idle`, so core counts
  a turn
- **THEN** the desk shows Codex idle (ready) within a few seconds, as its
  prompt is on screen, and no finished alert or chime is pushed

#### Scenario: A real turn still finishes

- **WHEN** a Claude Code or Codex agent answers a message and reports `done`
- **THEN** the desk shows done and World pushes "completed" until a person
  sees the turn, as before

#### Scenario: A harness without done

- **WHEN** a harness that does not report `done` goes from `working` to
  `idle` above the shared seen turn
- **THEN** the desk shows done, as in Herdr's apps
