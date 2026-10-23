### Added

- Your open pull requests get a card in Work with CI on the head, each rev
  agent's latest result and your merge rules (not a draft, findings confirmed,
  CI green, mergeable, screenshots for UI changes), each ✓, ✗ or unknown.
- Merge (a merge commit pinned to the head you saw), close and mark ready from
  the card, each behind a sheet that says exactly what happens; GitHub's
  answer shows on the card. World never bypasses branch protection: while a
  review is required it offers Open on GitHub and the merge command instead.
- Cards say **Ready to merge** when every rule holds, and **Stalled** when CI
  failed on the head and its agent is idle.
