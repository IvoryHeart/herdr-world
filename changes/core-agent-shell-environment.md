### Fixed

- Start core agents with the host's interactive shell environment, including
  shell-added tools such as bun and nvm, with login startup on macOS.

### Known issues

- Codex on Linux core stays unknown when the core/harness supplies no native
  status. Current Linux core 0.1.21 / Codex 0.167.0 reports work; World cannot
  reconstruct missing reports from Chat or Terminal output.
