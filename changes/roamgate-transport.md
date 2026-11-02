### Fixed

- Keep SSH command traffic responsive with private runtime-owned shared connections,
  bounded background work, keepalives and clear refusal of oversized Herdr requests.
- Cancel queued SSH commands, workspace Files uploads and terminal uploads when their runtime retires; retain failed-start
  master ownership until confirmed exit and keep recovery within caller deadlines.
- Keep file-ignore checks, launcher discovery and integration-version checks on their
  owning connection when it disconnects.
- Refresh worktree Git status in the background without overwriting newer host-local
  updates, and batch untracked-file line counts.

### Added

- Add service-owned local and reverse SSH forwarding with qualified runtime ownership,
  bounded discovery and cleanup; web controls follow in the web/mobile integration part.
