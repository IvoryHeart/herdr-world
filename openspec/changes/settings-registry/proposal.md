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
- Controls that stay on a view (Board surface, status colours and pulses, Town lens,
  Manage connections) are listed and open the view's own control.
- `?setting=<entry id|category>` links open Settings at that entry or tab.
- A short Menu: the things people do every day, Settings, and the rest one tap away.

## Capabilities

### Modified Capabilities

- `world-surfaces/settings`: add the settings registry, search, links and short Menu; Settings
  is the common settings menu.

## Impact

Browser only: `web/src/settings/`, feature catalogs (`world/town/town.settings.tsx`,
`world/board/board.settings.tsx`), the Menu and the command box. No service, Herdr,
storage or protocol change; settings keep their current values and stores. The
current `world-surfaces` requirement that Inspector, calm motion and observability
settings live in the common settings menu still holds: they live in Settings, which
the Menu opens.

Open decisions are in the PR description (#1062) and the `crew:idea` slices
#1063 and #1065–#1067. The requirement below is synchronized into the current spec.
