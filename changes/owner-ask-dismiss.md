### Added

- Dismiss any open owner question from Town's **Needs you** list or Summary. It
  closes without an answer, `ask --wait` returns `dismissed`, and the crew
  watcher does not ask again while that cause holds.

### Fixed

- Name the asking agent in the **Needs you** list as Town labels its desk, with
  **Open agent**, and in the new-ask notification by its Herdr name (else its
  pane) with the question's first line.
- Bring an unverified ask to reception, marked unverified, when exactly one
  local Herdr has the pane it names, instead of leaving it in the list only.
