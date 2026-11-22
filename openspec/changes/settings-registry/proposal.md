## Why

World's settings are spread over the Menu, a five-tab Configuration dialog, detail
dialogs, a settings search and the command box, plus controls that live only on a
view (Town's time of day under ALL). Each surface keeps its own list and its own way
of finding things, so a person looking for "lighting" finds it nowhere. #451 proposed
a registry, categories, search and deep links; only its first fix was built. #1035
asks for one home and one search for every setting and command.

Settings and the short Menu are the default on desktop and phone. They replace the
old Menu and the Configuration dialog; the old `?settings=next` preview switch is
ignored.

## What Changes

- One registry of settings, panels and commands with stable IDs. A feature adds its
  own entries from its own folder; the shell does not change for a new entry.
- One search over that registry, used by the Settings screen and the command box.
  The command box's own commands are published into the registry, so both find the
  same commands and keep the command box's admission (a refused action is disabled
  with its reason, and the entries go when the command box goes).
- A Settings screen with tabs by kind, an All tab and one search, shaped like the
  Integrations screen.
- Board surface, Board status pulses and Town lens share subscribed browser stores;
  Settings and Cmd+K change an open view immediately. Their view controls remain.
- One Town master row opens the synced agent picker. Town and Board dock that exact
  holder; an explicitly saved browser name migrates once when uniquely resolvable.
- Board status colours and Manage connections still open their existing controls.
- `?setting=<entry id|category>` links open Settings at that entry or tab.
- A short Menu: the things people do every day, Settings, and the rest one tap away.

## Capabilities

### Modified Capabilities

- `world-surfaces/settings`: add the settings registry, search, links and short Menu; Settings
  is the common settings menu, with direct live view controls (#1065).
- `world-surfaces/appearance`: use one synced Town master for Town and Board and
  retire the per-browser name through a one-shot migration (#1066).

## Impact

Browser only: `web/src/settings/`, feature catalogs (`world/town/town.settings.tsx`,
`world/board/board.settings.tsx`), the Menu and the command box. No service, Herdr or
protocol change. Board appearance/pulses and Town lens become shared browser stores;
the retired browser Town master name is consumed before one qualified,
replacement-disabled assignment through the existing synced-role RPC. The
current `world-surfaces` requirement that Inspector, calm motion and observability
settings live in the common settings menu still holds: they live in Settings, which
the Menu opens.

Open decisions are in the PR description (#1062) and the `crew:idea` slices
#1063 and #1067. #1065 and #1066 are implemented by PR #1140. The original Settings
home requirement is synchronized; these follow-up contracts remain in this delta
until the post-main synchronization PR.
