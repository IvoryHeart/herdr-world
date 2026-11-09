### Added

- Standalone installs and World updates discover configured harnesses and install
  or refresh World's skills and Claude limits tap, reporting each harness and how
  to remove its integration. Set `HERDR_WORLD_SKIP_INTEGRATIONS=1` to keep these
  manual. Explicitly uninstalled integrations stay removed on later updates,
  including the shared Codex/Pi/Kimi skill; user-owned skills are preserved.
