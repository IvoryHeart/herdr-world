# Settings notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Menu → Settings is the common settings home; Find or act uses the same registry/search.
- Deep links ?setting=<entry/category> open one row/category and remove the parameter.
- Help opens Settings Help and offers current-screen Try controls on desktop and phone.
- TUI/core settings route to their real owner; unavailable command capabilities show reasons.

**Code:**

- `web/src/settings/registry.ts`
- `web/src/settings/search.ts`
- `web/src/settings/SettingsHome.tsx`
- `web/src/components/CommandCombobox.tsx`
- `web/src/help/helpEntry.ts`

**Tests:**

- `web/src/settings/settings.dom.test.ts`
- `web/src/commandBoxKey.dom.test.ts`
- `scripts/check-knowledge-map-links.test.ts`

**Pitfalls:**

- Register feature settings in their module rather than adding a second dialog.
- Duplicate IDs fail immediately; command entries retain command-box admission and lifecycle.
- Retired ?settings= must be consumed without changing preferences.
- Help pictures are refreshed on main; this split changes no help declaration.
- CLI configuration remains feature-specific, not a second Settings registry.

## Usage reference

## Settings

**Menu** holds what you do every day; **Settings** holds everything else, with
one search. Paths in this file such as **Settings → Theme** name a row you can
also find by typing its name.

- **Menu** lists **Settings**, **Find or act**, **Zen mode**, **Help**,
  **Upgrade** (only when one is offered) and **Log out** (only when World asks
  for a password). **Help** opens Settings at its Help tab.
- **Menu → Settings** lists every setting and command under **All** and nine
  tabs: Appearance, Town & views, Notifications & sounds, Agents, Keyboard,
  Integrations, This World, Commands and Help. Each row names where it applies
  (this browser, all browsers, one connection) and, for a control that also
  lives on a view, where (Town's sun button under **ALL**). Arrow keys move
  between tabs; Tab stays inside Settings.
- Most rows change in place. **Open** shows a page inside Settings (**Read
  replies aloud**, **World name**, **Worktree command**, **Terminal
  transport**, **Integrations**, **Herdr and connection details**), where Back
  or Escape returns to the list, or opens a dialog (**Layout**, **Terminal
  colours and font**, **Keyboard shortcuts**, **Phone terminal keys**,
  **Automatic branch updates**) that returns to Settings at its row when
  closed. **Agent profiles** and **Chimes and who plays them** open their own
  windows.
- Controls that stay on a view are rows too: **Board surface**, **Board status
  colours** and **Board status pulses** switch to Board and open its settings
  menu or colours; **Town lenses** switches to Town and opens the lens
  chooser; **Hosts and connections** opens **Manage connections**.
- **This World** holds **Herdr and connection details** (Herdr version,
  upgrade or setup, connection address), **World name**, update checks,
  **Reload page** and **Log out**. **Help** opens the tutorial, this file,
  troubleshooting, issues and the changelog in a new tab.
- **Commands** lists what Cmd+K offers for the open workspace, tab and pane
  (**new workspace** finds **Create workspace**). A command Cmd+K refuses is
  shown greyed with its reason, and runs only through Cmd+K for the active
  connection; when Cmd+K cannot act, its commands leave Settings.
- The search finds a setting by its name, its words and its choices:
  **lighting** and **night** find Town's time of day, **font size** finds the
  terminal, interface and chat sizes, **sounds** finds sound on this device,
  **weather** finds the Weather source's place and on/off.
  The control in the result changes the setting at once.
- **Cmd+K** (`Ctrl+K`) finds the same settings and commands. A choice offers
  each option (**night** → **Town time of day: Night**), a switch offers
  **turn on/off** and a size offers **larger/smaller**; Enter applies it.
- Each row's link button copies an address ending in
  **`?setting=<id>`** (for example `?setting=town.time-of-day`), or
  **`?setting=<tab>`** such as `?setting=help`. Opening it opens Settings at
  that row, highlighted. The old `?settings=next` preview switch is ignored.
- On a phone the Menu and Settings are sheets: swipe the handle down to close.
  Settings is full height; tabs scroll sideways and wide controls take their
  own line.
