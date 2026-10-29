### Added

- Dismiss any open owner question from Town's **Needs you** list or Summary. It
  closes without an answer, `ask --wait` returns `dismissed`, and the crew
  watcher does not ask again while that cause holds.

### Fixed

- Name the asking agent, as Town labels its desk, in the **Needs you** list and
  the new-ask notification, with the question's first line and **Open agent**.
- Bring an unverified ask to reception, marked unverified, when exactly one
  local Herdr has the pane it names, instead of leaving it in the list only.
