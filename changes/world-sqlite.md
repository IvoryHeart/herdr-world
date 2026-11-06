### Changed

- Store agent questions, answers, task results and attention delivery in the
  instance's private `world.sqlite`, with a backed-up, idempotent JSON import.
  The service owns ask alerts; interrupted sends retain explicit delivery
  uncertainty and answers remain available through `ask get` after restart.
