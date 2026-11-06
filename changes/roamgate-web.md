### Added

- Refresh Roamgate source through `2b16e991` after v0.8.13 for the web: an
  **All servers** Spaces list, Pane Search across servers and numbered tab chips
  with agent status, all read from World's shared observation.
- Choose where each repository's worktrees go, create worktrees in repositories
  without an `origin`, and set commands that create or remove worktrees on the
  workspace's host. World's navigator shows the worktree actions on desktop and
  phone; a stale host leaves them inert.
- Read agent replies aloud in History Chat, with an on-device voice unless you
  choose another.
- Draw PDFs with PDF.js on phones and other browsers without a PDF viewer; it
  loads only when such a browser opens a PDF.
- Add a black background for the dark theme, an opt-in macOS Option-as-Alt
  setting for terminals and opt-in browser latency samples (`?debugLatency`).

### Changed

- Keep keyboard shortcuts on the World service so they follow every browser.
- Start each browser on the connection it last used, keep recently viewed
  terminal streams warm for quick switches, and keep pull request badges across
  reloads and reconnects, shown as stale until checked.

### Fixed

- Keep Pane Search's selected match when moving through results with arrow keys.
- Keep unsent Message drafts across a reconnect to the same destination, in
  memory only.
- Return clipboard writes from composer-sent commands to the sending browser,
  send uploaded image paths so Claude Code attaches the image, keep password
  managers off search fields, and open a plugin popup on its own Space.
