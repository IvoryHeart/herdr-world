## Context

The preview is in `web/src/settings/` behind `?settings=next`. The PR (#1062)
holds the design note, captures and the upstream draft; this file keeps the
choices and the audit that later slices check against.

## Decisions

- **The registry holds how to read and change a value, never the value.** Values
  stay in today's stores, so Settings, the view and the old dialog show one value
  and no migration of stored data is needed.
- **Features register their own entries** with `defineSettings(source, entries)` in
  their own folder (`world/town/town.settings.tsx`, `world/board/board.settings.tsx`)
  and one import line in `settings/catalog.ts`.
- **The command box publishes its commands** (`settings/commandBoxRegistry.ts`) into
  the `commands` category rather than the registry copying them. The command box
  builds them from what is open now, so only it knows the focused workspace, its
  connection and whether an action is admitted. Settings shows its refusal reason
  and runs the action through the command box's own `run`, which re-checks that
  operational actions are enabled. When the command box unmounts (another
  connection, Zen mode), its entries are withdrawn rather than run elsewhere.
- **One search** (`settings/search.ts`). Settings searches every entry; the command
  box ranks its own commands with the same scorer and adds the other entries, so
  both list the same results.
- **View controls stay on their view.** `settings/viewControls.ts` switches to the
  view and asks it to open the control; the view answers once, on mount or at once,
  and a request expires after five seconds. Shared stores for these controls are
  slice #1065.
- **Availability is live.** `useShownEntries` subscribes to every entry's source,
  so a dependent row appears when its parent setting changes.

## Audit: every setting and where it is changed today

Desktop Menu = the dropdown Menu; phone Menu = the bottom sheet, whose "Quick
settings" opens the Configuration dialog tabs. "Config" = the Configuration dialog.

| Entry ID | Setting | Today (desktop and phone) |
|---|---|---|
| appearance.theme | Theme | Config → Appearance |
| appearance.black-background | Black background | Config → Appearance |
| appearance.accent | Accent colour | Config → Appearance |
| appearance.interface-scale | Interface size | Config → Appearance |
| appearance.terminal-font-size | Terminal font size | Config → Appearance → Terminal dialog |
| appearance.chat-text | Chat text size | Config → Appearance |
| appearance.terminal-look | Terminal colours and font | Config → Appearance → Terminal dialog |
| appearance.layout | Layout | Config → Appearance → Layout |
| town.time-of-day | Town time of day | Town: sun button under ALL only |
| town.calm-motion | Calm motion | Menu → Views |
| views.agents-open | Opening an agent shows | Menu → Views |
| views.inspector-opening | Inspector opens | Menu → Views (desktop only) |
| town.master | Town master (this browser) | Menu → Views |
| town.greeting | Town master greeting | Menu → Views |
| town.lenses | Town lenses | Town: L or the ring's Lenses action only |
| town.event-trace | Town event trace | Menu → Views (development builds) |
| board.surface | Board surface | Board: ⋮ Board settings only |
| board.status-colours | Board status colours | Board: ⋮ Board settings → Status colours only |
| board.pulses | Board status pulses | Board: ⋮ Board settings only |
| sounds.on, sounds.volume | Sounds on this device, volume | Menu → Sounds dialog |
| sounds.chimes | Chimes and who plays them (synced Town master role) | Menu → Sounds dialog |
| notifications.tasks | Task notifications | Config → Behavior |
| notifications.needs-attention, notifications.completed | Which tasks notify | Config → Behavior, once task notifications are on |
| notifications.tab-count | Count on tab and app icon | Menu → Views |
| agents.profiles | Agent profiles | Menu → Agent profiles dialog |
| agents.speech | Read replies aloud | Config → Behavior |
| agents.worktree-command | Worktree command | Config → Instance |
| keyboard.cheat-sheet | Shortcut cheat sheet | Menu (desktop only) |
| keyboard.shortcuts | Keyboard shortcuts | Config → Behavior |
| keyboard.option-as-alt | Option key as Alt | Config → Behavior (macOS only) |
| keyboard.phone-keys | Phone terminal keys | Config → Behavior |
| keyboard.find | Find or act (Cmd+K) | Keyboard shortcut; top bar search |
| integrations.sources | Sources | Menu → Sources dialog |
| integrations.metrics | Economy metrics (OTEL) | Menu → OTEL economy metrics dialog |
| integrations.agents | Agent integrations | Config → Integrations |
| integrations.hosts | Hosts and connections | Top bar Hosts → Manage connections (phone: view menu) |
| integrations.terminal-transport | Terminal transport | Config → Connection |
| integrations.branch-sync | Automatic branch updates | Config → Connection |
| system.name | World name | Config → Instance |
| system.zen | Zen mode | Menu |
| system.update-checks | Automatic update checks | Config → Behavior |
| system.check-updates | Check for updates | Menu → Help & updates |
| system.reload | Reload page | Menu → Help & updates |
| system.runtime | Herdr version, upgrade or setup, connection details | Menu → Runtime |
| system.log-out | Log out | Menu, when signed in |
| help.* | Tutorial, features, troubleshooting, report, changelog | Menu → Help & updates |
| command.* | Workspace, tab, pane, agent and window commands | Command box only |

With the preview on, every row above is found by the one search and opens or
changes from its result. Rows that still open today's dialog are moved whole in
slice #1063.
