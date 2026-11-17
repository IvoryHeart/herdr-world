### Added

- World on Windows connects to a herdr-core running on the same computer, over
  core's named pipe, with the same existing-only checks as a Windows SSH host.
- On Windows x64, `herdr-world herdr setup` and `herdr upgrade --install` with
  no runtime install herdr-core (core's own checksum-verified PowerShell steps)
  instead of Herdr, start it now and at login from your Startup folder, and
  **Install herdr-core…** beside This computer does the same and connects it.
