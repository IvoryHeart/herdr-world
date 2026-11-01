### Added

- Complete Claude Code and Codex command menus such as `/model` and `/permissions` in Chat: a menu card shows the options, the cursor, the menu's keys and any text field, checks each key against that menu and session, and follows each step until the menu closes.
- Press the Terminal's key controls (arrows, Esc, Tab, Enter, Ctrl keys) from Chat's **⋮** menu on desktop and phone, sent only to the session Chat shows.
- Chat never types into an open harness menu: while a menu is open, Send is disabled and the service refuses a message or command, since typed text would go into the menu as keys. A slash command sent while the agent is busy shows that it is waiting for the agent, and the same command is not queued twice.

- Retrying a slash command after a definite native refusal works; unreadable or older observations keep a busy command reserved and its waiting notice intact.

- SSH Chat keeps ordinary text sendable after an assistant quotes terminal instructions, including when the browser supplies the delivery baseline; open menus and unreadable screens still refuse input.
