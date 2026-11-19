### Added

- Open projects and files from World in installed VS Code, Cursor, JetBrains IDEs or Zed, with a saved default, phone-friendly picker and connection-qualified SSH handoff or refusal.

### Fixed

- Discover existing local herdr-core and Herdr TUI together on a fresh World start, so IDE handoff can use their projects without reinstalling either runtime.
- Let the testing-only IDE preview open its picker from Integrations without a runtime connection.
- Launch desktop IDEs outside World's service lifetime using a separate Linux user scope or macOS LaunchServices, so restarting World does not close the editor.
- Keep agent names readable beside the IDE handoff control in narrow Inspector windows, including when controls grow after the window opens.
