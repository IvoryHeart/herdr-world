### Fixed

- Chat and History can read Claude Code conversations on Unix SSH hosts when
  Herdr reports the session UUID. Lookup uses the selected host's transcript
  files, refuses ambiguous matches and never falls back to a local conversation.
  Readable, bound conversations support the existing session-checked Chat Send.
- Symlinked remote projects roots are resolved on their host. Discovered paths
  and stat results must retain the requested session and project-root binding.
