### Fixed

- Start core agents with the host's interactive shell environment, including shell-added tools such as bun and nvm, with login startup on macOS.
- Preserve direct core discovery and launching for unsupported account shells, including csh, tcsh, nu, xonsh and elvish.
- Start Claude from New agent in Unix Herdr TUI rooms without truncating the status-line tap at the shell's terminal input limit.

### Known issues

- Codex on Linux core stays unknown when the core/harness supplies no native status. Current Linux core 0.1.21 / Codex 0.167.0 reports work; World cannot reconstruct missing reports from Chat or Terminal output.
