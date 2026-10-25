### Fixed

- Chat and History can read Claude Code conversations on Unix SSH hosts when
  Herdr reports the session UUID. Lookup uses the selected host's transcript
  files, refuses ambiguous matches and never falls back to a local conversation.
  Readable, bound conversations support the existing session-checked Chat Send.
