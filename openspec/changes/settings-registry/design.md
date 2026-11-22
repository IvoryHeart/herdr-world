## Context

Settings is in `web/src/settings/` and is the default; the `?settings=next` preview
switch is retired. The PR (#1062)
holds the design note, captures and the upstream draft; this file keeps the
choices and the audit that later slices check against.

## Decisions

- **The registry holds how to read and change a value, never the value.** Values
  stay in today's stores, so Settings, the view and any detail dialog show one value
  and no migration of stored data is needed for live view settings.
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
  and a request expires after five seconds. Board surface/pulses and Town lens
  instead use subscribed module stores (#1065), shared with their existing controls.
  Town's active lens survives same-page navigation; a fresh page starts in Attention
  and remembers the last non-Attention lens for L and the ring.
- **One Town master is the synced role.** Settings opens the existing Sounds picker;
  Town and Board dock the exact connection/terminal holder without taking focus.
  A legacy explicit browser name waits for loaded profiles and one unique current
  match, preferring native name to label. An existing synced holder wins. The old
  key is consumed before one qualified replacement-disabled RPC; storage refusal
  prevents dispatch and RPC failure reports without replay. Other preference edits
  preserve a pending name. The default implicit firstmate name is not imported.
- **Migration evidence.** The migration matrix exhausts the synchronous admission,
  deferral, consumption and failure branches; actual docking consumers have unit
  and Town/Board browser checks. Assignment serialization and runtime generation
  checks reuse the existing service contract. No new concurrent state machine is
  introduced; the full verification gate retains authority and recovery coverage.
- **Availability is live.** `useShownEntries` subscribes to every entry's source,
  so a dependent row appears when its parent setting changes.

## Audit: every setting and where it is changed today

The audit records where each setting lived before Settings became the default.
Desktop Menu = the old dropdown Menu; phone Menu = the old bottom sheet, whose "Quick
settings" opened the Configuration dialog tabs. "Config" = the retired Configuration
dialog.

| Entry ID | Setting | Before (desktop and phone) |
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
| integrations.sources | Sources (GitHub, Jira) | Menu → Integrations, or Config → Integrations (#1026) |
| integrations.metrics | Economy metrics (OTEL) | Menu → Integrations, or Config → Integrations (#1026) |
| integrations.weather | Weather place and source (#1111) | Town: sky button → Weather place and source… (#1061) |
| integrations.agents | Agent integrations | Menu → Integrations, or Config → Integrations |
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

Every row above is now in Settings, found by the one search, and opens or changes
from its result. Rows that still open a detail dialog are moved whole into Settings
pages in slice #1063.
