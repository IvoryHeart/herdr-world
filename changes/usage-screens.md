### Added

- Town's observatory opens Usage with harness budgets and reset times, overlapping work, token breakdowns and signs of waste; phones show a folded sign.
- Usage has a Breakdown tab: time at work, time waiting on you, tokens, cost and pull requests opened and merged per agent, project, room and day, with "unknown" where World has no reading.
- Harnesses whose logs World does not read still show their runs and the time World measured; tokens and cost say they are not available.
- An agent's peek and hover card show its run's role, item, tokens, calls and largest prompt, or World's time for harnesses without a log.
- Usage analytics can group by run, with role, branch, pull request (and how it was linked), calls, largest prompt and working spans. `?usageFixture` tries rare states.

<!-- detail -->

- Town has an observatory right of the library: each harness's 5-hour and
  weekly budget used with reset times, a lit window per agent at work, and on a
  phone a folded sign. It opens Usage, with budget pace, runs at once by hour
  (building vs reviewing and checking, counted as true overlap) and tokens by
  run, role, item and project, flagging likely waste such as repeated fixer
  rounds or a nearly full context.
