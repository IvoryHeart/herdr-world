### Added

- Deliver new verified agent questions’ saved answers to their original Chat
  session without requiring `--wait`. Town Summary’s Outbox keeps pending,
  unconfirmed and not-sent deliveries reachable, with explicit same-session
  Send again or Dismiss. Changed sessions are skipped; answers remain available
  through `ask get`.
