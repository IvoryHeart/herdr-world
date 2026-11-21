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
