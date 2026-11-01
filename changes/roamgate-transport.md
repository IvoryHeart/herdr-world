### Fixed

- Keep SSH command traffic responsive with private runtime-owned shared connections,
  bounded background work, keepalives and clear refusal of oversized Herdr requests.
- Refresh worktree Git status in the background without overwriting newer host-local
  updates, and batch untracked-file line counts.

### Added

- Add service-owned local and reverse SSH forwarding with qualified runtime ownership,
  bounded discovery and cleanup; web controls follow in the web/mobile integration part.
