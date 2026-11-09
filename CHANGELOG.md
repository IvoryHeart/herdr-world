# Changelog

This changelog records Herdr World releases and downstream changes. Current releases identify the
exact Roamgate source synchronization in [UPSTREAM.md](UPSTREAM.md); historical release entries
retain their original Herdr Web lineage. Unreleased entries describe user-facing changes; PR links
are optional because the merged PR history records their source. New entries arrive as
fragments under [changes/](changes/README.md) and are added here when a stable release is
prepared.

## [Unreleased]

## [0.3.0] - 2026-11-09

### Added

- Bring in Roamgate v0.8.8: configurable agent launches from mobile shells and
  a History Chat message box with image uploads and explicit confirmation when an
  agent is busy or unknown, including Codex.
- Town shows a thought bubble over each working agent once you zoom into a
  room: a glyph for the step it runs now (editing, tests, a command, reading
  code, the web, thinking, or a subagent), with its time in amber when the
  step has run unusually long. At the desk level, or on the selected desk,
  the bubble adds what the agent is doing now and the step in words, such
  as `Run the login tests · tests 3m`: the running step's own detail, its
  plan item in progress or its latest request, not a session's first
  topic. Steps come from what Chat's Now bar reads, for Claude Code, Codex
  and Pi, and only for agents on screen.
- The Town Master greets you on each visit to World: a small figure beside
  the town board opens one card with when you were last here, the same
  **Since you left** lines as the board sign (each opens **Needs you**) and,
  when a newer release is out, a **See update** line that opens **Menu** at
  its update entry. Board opens it at its hub and Desk at its summary; phones
  show a sheet with **Back**. It never opens over Chat, **Needs you** or
  another window; one docked elsewhere on a wide screen does not hold it back. **Show this on start** (on by default, also
  **Menu → Town Master greeting**) turns it off on this browser.
- While anything needs you, World's browser tab reads `(N) Herdr World` and
  its icon carries a small badge with the number (`9+` above nine), in every
  view and while the tab is in the background. An installed World shows the
  number on its app icon where the system supports app badges.
  **Menu → Count on tab and app icon** turns it off for this browser.
- Snap a World window to the right or left edge at its normal docked width with
  **⋯ → Fit right** or **Fit left**, instead of half the screen. It uses 520 px
  (at most half the screen) or the width you last dragged a docked window to,
  works in Town, Board, Desk and Spaces, and is in **Actions** for a custom
  shortcut.
- Town shows each agent's context fill like a needs bar: a slim bar with the
  percent in the peek and under the icon in the agent's window, read from
  Claude, Codex, Pi and Gemini logs against the model's context window. At
  85% or more an agent shows a sweat drop at its desk. Agents without a
  reading show no bar. `world.usage.get` reports it as `contexts`.
- Deliver new verified agent questions’ saved answers to their original Chat
  session without requiring `--wait`. Town Summary’s Outbox keeps pending,
  unconfirmed and not-sent deliveries reachable, with explicit same-session
  Send again or Dismiss. Changed sessions are skipped; answers remain available
  through `ask get`.
- `herdr-world ask` also alerts you through the asking pane's Herdr, so a
  question reaches Herdr's toasts, every connected World and phone
  notifications even with no World tab open. An ask nobody was alerted to
  exits 6 (`not_delivered`) with its recorded ID, and one World could not
  record still sends the alert, names the failure and exits 1.
- `HERDR_WORLD_DATA_DIR` gives a World instance its own data folder.
- Standalone installs and World updates discover configured harnesses and install
  or refresh World's skills and Claude limits tap, reporting each harness and how
  to remove its integration. Set `HERDR_WORLD_SKIP_INTEGRATIONS=1` to keep these
  manual. Explicitly uninstalled integrations stay removed on later updates,
  including the shared Codex/Pi/Kimi skill; user-owned skills are preserved.
- Board's Next control opens the next pane that needs you, including shared
  shell questions, and keeps its place after an answer. Its menu now offers
  Whiteboard and Blackboard surfaces, separate status colours and Help.
- Drag a pane row or a single-pane tab's grip onto another tab on the same host
  to move just that pane, including with touch hold; cancelling sends no move,
  and closing the old room requires confirmation.
- Board has a hub beside its bin with the town center's actions: **+**
  launches a new agent (in the selected card's workspace when it can), the
  crown opens the Town master's Chat, and **⋯** opens a menu with **New
  agent**, **Town master**, **Needs you**, **Summary** (Town, with its
  summary open), **Profiles** and **New workspace**. Escape, a tap outside
  or **Back** on a phone closes it. Board's controls keep clear of the hub.
- Board shows Town's lenses (Idle time, Spend, Pull requests, Quests and
  Harness) over its cards, from the same facts: press **Lenses** in Board's
  controls or `L`. Board also shows Town's **Since you left** recap after a
  return, and each tab's pull request or ticket badge, as on Town's desks.
- Board offers Town's actions on a selected card: rename and close a room with
  Town's dialogs, move a room or tab earlier or later in Herdr's own order (so
  Town and Spaces follow, while dragging still arranges only the Board), Mark
  reviewed on a finished agent, and a peek at an agent (hover, or Preview on a
  phone) with its latest Chat message, its question and answer buttons.
- The `?scene=town-scale` preview's synthetic hosts now take Town's and
  Board's room actions, peeks, answers and review marks in the page, so they
  can be tried without real hosts.
- Show Town's facts on Board: a summary chip with Busy, Waiting, Done and
  Quiet counts that opens expenses today and over 7 days, harness limits with
  the reading's age, unreviewed finishes and each host; host zones and
  workspace cards carry their counts, expenses and limits, and agent cards
  show the running step (amber when long), review state or idle time.
- Complete Claude Code and Codex command menus such as `/model` and `/permissions` in Chat: a menu card shows the options, the cursor, the menu's keys and any text field, checks each key against that menu and session, and follows each step until the menu closes.
- Press the Terminal's key controls (arrows, Esc, Tab, Enter, Ctrl keys) from Chat's **⋮** menu on desktop and phone, sent only to the session Chat shows.
- Chat never types into an open harness menu: while a menu is open, Send is disabled and the service refuses a message or command, since typed text would go into the menu as keys. A slash command sent while the agent is busy shows that it is waiting for the agent, and the same command is not queued twice.

- Retrying a slash command after a definite native refusal works; unreadable or older observations keep a busy command reserved and its waiting notice intact.

- SSH Chat keeps ordinary text sendable after an assistant quotes terminal instructions, including when the browser supplies the delivery baseline; open menus and unreadable screens still refuse input.

- Chat refuses text on partial boxed questions and blank-padded menus, checks that the terminal/state still matches its screen observation, and accepts quoted instructions with Claude's message prefix.

- Claude Code's `/model` menu card also shows on a phone-width terminal, where Claude wraps the menu's key line onto two rows.
- When an actual terminal row read shows it is too small to read the current session's command menu, Chat explains this and offers **Open Terminal**. Unknown or stale observations do not produce a size claim; menu and send authority stay unchanged.
- Installing the Claude World integration now chains your existing status line
  through the limits tap, so Claude sessions started outside World update Fuel.
  Reinstall avoids double wrapping; uninstall restores the original setting and
  preserves intervening edits, while malformed settings are left untouched.
- Show a Claude gauge beside Codex on the Town board's **FUEL** row and in the
  Summary: how much of the Claude subscription's 5-hour and weekly limits is
  left, with reset times. Claude agents started from World's launcher get a
  per-launch status line tap that records these numbers and then shows your
  own status line unchanged; your Claude settings files are never edited.
  It appears within about a minute of the agent's first answer. When Claude
  refuses work at its limit, the gauge reads **reached, resets …**.
- Chat answers Claude's folder-trust question before its session starts: the
  card shows **No, exit** and **Yes, I trust this folder**, and a click is
  checked against the same question and Claude process before each key.
  For pre-approved tool grants, **No, continue without these permissions**
  continues Claude without those grants instead of exiting.
- World's command box: press `Cmd+K` on a Mac or `Ctrl+K` elsewhere in Town,
  Board or Desk, type, and it finds buildings, rooms, tables, agents and
  terminals as the views' search does, with status marks and places. Enter
  selects one as clicking it in the view does. It also goes to another view
  and keeps every action the Actions menu had. In Zen a **⌘** button beside
  the view buttons opens it; on a phone, **Find or act** in the corner view
  menu.
- Keep owner questions at Town reception with a quiet question mark, also shown
  in Board and Desk. New verified asks chime, show a toast and raise an OS notice
  with an action for the original asking seat.
- Let verified askers deduplicate causes and withdraw questions once they clear.
  Crew owner notices now use the existing World question ledger and read answers
  back to the watcher.
- Recover and retire asks after lost CLI replies, re-arm recurring causes after
  a lost withdrawal reply, and explain permanent withdrawal refusals once.
  Shell questions take reception priority over finished agents. Keyed CLI repeats
  retain their answer state and withdrawal output names the preserved answer.
- Preserve answer acknowledgements through held or out-of-scope causes and
  uncertain withdrawals. Keep historical owner notices quiet and distinguish
  missing keyed asks from confirmed withdrawals.
- Expand a Desk host summary to reveal and open an agent outside the Hosts filter,
  with the destination host named explicitly and existing Inspectors preserved.
  Host controls stay visible beside a reading pane and wrap below the counts
  on phones. Cached, unavailable or replaced agents explain why they cannot open.
- Read bounded agent token usage from Claude Code, Codex, Pi and Gemini session
  files through qualified local and SSH connections, with shared World usage
  records, attribution, source health and optional local price-table estimates.
  Recovered counters and copied transcripts count once; incomplete or changing
  claims remain host-level, and cancelled or oversized reads release owned resources.
  Reuse bounded host-local parser caches for incremental reads. Old Codex trees
  use bounded metadata discovery for recent activity; incomplete identity evidence
  never establishes a unique title-prefix match. Verified file handles, retryable
  offsets and owned reader failures preserve containment and cache recovery.
- Manage Teams and Pods with `herdr-world group` and `pod`/`team` aliases,
  explicit role transfers and promotion, ordered Now lists and recent sender attribution.
  Read Herdr Rooms/Desks through the same Group vocabulary; `--herdr` membership
  moves show the complete effect first and report observed outcomes, preserving
  chosen desk colours and spawn-parent colour inheritance.
- Import a Pod crew table once with explicit confirmation and address mappings;
  render World's current roster as Markdown without file synchronization.
- Open Actions → Groups for a panel roster and detail with kind filters,
  member/role management, linked PR cards, Now and recent attribution; stale
  confirmations refresh the roster without changing membership.
- Set Team/Pod Focus or Mute without copying member preferences; agent bells
  and mobile Attention menus distinguish inherited Default from explicit Watch;
  agent bells explain the winning claim.
  Focus follows current resolved members, with unchanged reception counts.
- Read Pod status, Now and source-qualified PR warnings in Town Summary;
  tap a row to open or restore its Groups detail without changing reception counts.
- A window for a multi-pane tab, such as a review round, starts its title with
  a drawing of the tab's split. Tap it to open a map of the real layout, then
  tap a pane to show that agent's Chat or terminal in the same window. The
  agent that needs you is marked in yellow, and Herdr's own focus stays put.
- Let owners park crew watched pull requests with the `on-hold` label and see them in crew status.
- Attach files and screenshots to an answer in **Needs you**: the paperclip in
  the answer field (or a paste or drop) uploads each file as a removable chip
  with a thumbnail, and the answer ends with `Attached files:` and the stored
  paths, which the asker receives and `herdr-world ask get` shows.
- **Needs you** is a tab on the left of every view, opened from the **Needs
  you** counter in the top bar (in the view picker in Zen and on a phone). It
  sits beside the view on wide screens, over it on narrower ones and full
  screen with **Back** on a phone, and stays open or closed per device. Each
  question, blocked agent and finished task is a short message from its agent
  with its quick reply in place: options or a typed answer and **Dismiss**,
  the agent's own question answered as Chat does, or **Mark reviewed**.
  **Chat about this** opens the agent's Chat, and hovering the agent's name
  (or **ⓘ**) shows its card. Town's reception letters, Desk's **Answer** and
  a Board card's **!**/**✓** badge open it at that item, every time, even
  after you turn the page. **✉ Outbox** at its foot opens Town's Summary at
  saved answers to check.
- Add negotiated observation v1 service replies: callers can retain unchanged
  hosts using generation-qualified tokens, with complete recovery after a service restart.
- When the local Herdr connection is failing and no host is ready, Town offers
  the existing **Set up Herdr** card to install or start Herdr after you
  confirm.
- Dismiss any open owner question from Town's **Needs you** list or Summary. It
  closes without an answer, `ask --wait` returns `dismissed`, and the crew
  watcher does not ask again while that cause holds.
- Use the service account's Claude Code CLI with Ranger, show a workspace or session
  in the asking window, and schedule tasks over all authorized workspaces.
- Read local Oh My Pi and directory-inferred Pi history, follow Claude continuation
  and queued messages, and fetch appended SSH transcript bytes within World bounds.
- Add service-owned local and reverse SSH forwarding with qualified runtime ownership,
  bounded discovery and cleanup; web controls follow in the web/mobile integration part.
- Refresh Roamgate source through `2b16e991` after v0.8.13 for the web: an
  **All servers** Spaces list, Pane Search across servers and numbered tab chips
  with agent status, all read from World's shared observation.
- Choose where each repository's worktrees go, create worktrees in repositories
  without an `origin`, and set commands that create or remove worktrees on the
  workspace's host. World's navigator shows the worktree actions on desktop and
  phone; a stale host leaves them inert.
- Read agent replies aloud in History Chat, with an on-device voice unless you
  choose another.
- Draw PDFs with PDF.js on phones and other browsers without a PDF viewer; it
  loads only when such a browser opens a PDF.
- Add a black background for the dark theme, an opt-in macOS Option-as-Alt
  setting for terminals and opt-in browser latency samples (`?debugLatency`).
- Preserve the provenance of agent status, session and pull request link observations
  in backend read models. Conflicting reports coexist, source outages retain their
  evidence, and action authority keeps its existing fresh source checks.
- Edit the native tab name, shared colour and status, and individual pane avatars
  from terminal title bars on desktop and phone. Board, Town, Desk and Spaces
  show the same choices, with field-specific resets and visible save failures.
- Town's board sign shows **Since you left** after 30 minutes or more away:
  new questions and blocked agents, finished work to review and merged pull
  requests, each line opening Needs you at that item, where new arrivals
  carry a "new" dot. On a phone it is one line under the summary chip.
- Notice when a long-open tab runs a different build than the service now
  serves, with **Reload** and **Later**. **Menu** shows the tab's build and,
  when they differ, the served build.
- Town reception overflow: when a reception queue is full, the remaining
  waiting or finished agents crowd the lobby in queue order, grumbling with a
  `#@!` bubble, and nap on the floor after about 90 seconds. A freed queue
  spot goes to the front of the crowd. Calm motion holds the crowd still.
- Town plays a new agent's arrival when World confirms its start: it steps
  out at the town center (or at the bus stop nearest its room when started
  elsewhere), walks to its building, goes in and sits at its desk, and a
  sparkle and its name fade over it. Several starts at once arrive one after
  another; reloads, failed starts and agents already in Town play nothing.
  With reduced motion the agent appears at its desk with a fading highlight.
- Open Town with `?scene=town-scale` to see a synthetic town at full scale: 3
  hosts, 24 rooms, 312 desks and 291 agents in every state. The report
  `docs/design/town-at-scale.md` shows how it reads at each zoom.
- Put an agent in the bin by dragging it onto the bin icon in Town or Board (or
  a Town bus stop), or from its window's **⋯** menu in Town, Board or Desk. In
  Town it walks to the London bus stop nearest its room, where a countdown board
  shows the time to the next bus; a red double-decker
  comes every four minutes, slows to each stop, waits about ten seconds, and
  closes its riders' agents only once it has left the screen. Tap the bus to
  stop it; closing the tray it opens lets it go on. The **Bin** tray shows who is waiting and the time to the next bus,
  with **Put back** (until the bus has left, even after boarding) and
  **Close now**. A pinned desk or tab keeps its last agent, and
  restarting World closes nothing that was waiting.
- Town has a town center: a domed hall at the top of the map, centred above
  the first street, replacing the reserved town-hall lot. Tap it (or its
  **Town center** plaque) for a ring of actions: **New agent**, **Town
  master**, **Needs you**, **Summary**, **Profiles** and **New room**. Escape,
  a tap outside, the centre **✕** or **Back** on a phone closes it.
- Town shows arrows at the view's edge to agents that need you out of sight
  when zoomed into a room or desk, with their mark and a count; click or tap
  one to travel there. On a desktop, **N** and **Shift+N** step the camera
  through what needs you in Needs you's order and open Needs you at each item;
  both keys can be rebound under **Town** in Keyboard shortcuts.
- Town shows what the crew spends: a City expenses billboard by the top
  street beside the town center (today or 7 days), and each building's
  reception board shows the host's expenses today and its costliest rooms, from harness usage. Missing, partial, stale and unpriced figures say
  so ("no data", "partial", "no price table") instead of showing zero, and
  figures that can no longer be refreshed read "out of date". On a
  phone they fold to signs that open on a tap.
- Show Codex subscription limits as fuel gauges on the Town board: each window
  (for example 5 h and week) with the percent left, amber and "low" under 15 %,
  and reset time, age and source on hover, focus or tap. The phone chip adds
  the lowest percent left. Claude reads "not available" on the board, and the
  Town summary lists each host's windows and says why Claude limits are not
  available. `world.usage.get` gains `limits`, read
  from Codex session logs on local and SSH hosts.
- Town's land is generated around the buildings: woods, meadows, hedged
  gardens and orchards, ponds and footpaths, with each street running on as a
  country lane. The land fills the whole view at every zoom and pan, with no
  plain green border. It is the same on every reload and changes only next to
  a building that grows.
- Town lenses: the town center's **Lenses** or `L` colours every room and
  desk by one fact (idle time, today's spend, linked pull requests, quests or
  harness), with a legend in the Town board's place, the value in words on
  hover, focus or tap, and a hatched "no data" look that is never drawn as
  zero. Escape or ✕ returns Town as it was.
- Move whole rooms in Town: drag a room by the Move handle in its plaque's
  card, by its name or by its wall (on a phone, drag the handle or touch and
  hold the name or wall) and drop it anywhere in its building, or use the
  card's Move before and Move after arrows. Its tables and agents go with it,
  rooms in its way move down, the building fits itself to its rooms, outlines
  show where every room will stand, and Escape puts it back. World saves the
  arrangement, so a reload and every device show it, and Herdr's workspace
  order follows the rooms' reading order, so Spaces matches.
- Escape puts back any desk, agent or room being carried in Town.
- Show agents that stopped on a subscription or usage limit as out of fuel in
  Town: slumped at their desks under an empty fuel can and a clock showing the
  reset time, in front of the room's plate and name tags, never at reception. Their table's card and Chat's Now bar say when the limit resets
  (for example `Usage limit reached · resets 15:00 (Codex)`), and room
  plaques, the Town board and the Summary count them on their own. World reads
  the stop from Codex's session log and Claude Code's transcript, and the state
  clears once the reset passes or the agent works again.
- Hover a Town room's nameplate, or a table or its nameplate, for its card:
  the Town board's numbers for that place, without its agents list: busy,
  waiting, done, quiet and its agents, then its economy today (estimated
  cost, tokens and models from harness usage). A room's card also holds
  Rename and Close, so one hover shows them all. Zoomed out, where room names
  are too small to point at, hovering anywhere over a room shows the same
  room numbers under its card. On a phone, tap the nameplate; the first
  tap on a table opens its card, and a second tap opens the table.
- Town has a post office on the first street, left of the town center: your open pull
  requests, including those whose agent has gone, as parcels in its sorting
  yard, ready to merge first, with counts on its sign. Tap a parcel for the
  pull request card the desk badge opens; a merged one is carried off. It is
  closed, with no parcels or counts, until the GitHub source is connected,
  and on a phone it folds to a sign on the town center.
- Choose which agents each Town reception takes. Press a reception's sign
  (**!** **?** **✓**) to untick Needs you, Asks you or Done for that building,
  or tick **Apply to all buildings** for every building. Agents that reception leaves out stay seated
  at their own desks with their mark, and reception shows a tag such as
  `✓ 4 at desks · find`: **find** opens the first of them and **Next ›**
  steps through the rest. **Reset to default** brings everyone back. Counts,
  Board, Desk and Needs you are unchanged, and World keeps the filter for
  every browser and device. Zoomed in to desks, tap a reception lobby to
  bring its board and sign back.
- Town's search shows where its matches are: matching buildings, rooms,
  tables and agents light up on the map, the rest dims a little, and the
  result line counts matches off-screen. Choosing a result moves the camera
  to it and pulses it; choosing it again opens it. Escape returns Town to how
  it was. In Zen, World's default, the search box hangs beside the view
  buttons at the top, or is a corner button on a phone, instead of hiding
  with the top bar. On a phone, the search box and its results open as one
  panel at the top of the screen, with the count shown once.
- Tidy rooms in Town: Tidy rooms on a building's sign (or the sparkles button
  on its reception board) glides all of that building's rooms into neat,
  gap-free columns in Herdr's workspace order, the arrangement a never-moved building has. World saves it
  like a room move, so it stays after a reload and Spaces keeps the order;
  tidying again changes nothing, and Undo in the note puts the rooms back.
- **/** and **Ctrl+F** (**Cmd+F** on a Mac) put the cursor in the search of
  Town, Board or Desk, or open the phone's search, without opening the
  browser's find. Terminals, the Chat composer and text fields keep those
  keys. Settings → Shortcuts lists them as **Search the current view**.
- Show a **− Minimize** button in every agent and terminal window header, in
  Town, Board and Desk and on phones. Minimizing or closing a window leaves its
  agent and terminal session running.
- On a phone, a minimized window waits as a chip at the bottom of Town or Board,
  or at the bottom of the window that is open: one tap restores it, without
  opening Tabs.
- Menu → Configuration → Integrations shows World's skill under each Herdr
  harness on World's own host: state, path, and Install, Update or Uninstall
  buttons that run the same installer as `herdr-world integration`.
  Uninstalling the file Codex, Pi and Kimi share names the harnesses that
  lose it before it runs.
- Install, check and remove the World skill with `herdr-world integration
  install|status|uninstall`, using Herdr's harness names. Codex, Pi and Kimi
  share one file; removal names all affected harnesses. The guide now teaches
  questions, durable results, expiring task summaries and parent-child stamps.

### Changed

- Document GitHub merged pull request pagination and its 1,000-result provider limit.
- Give list panels consistent command-picker styling while keeping World's app bar
  and window restoration. Default Codex launches to pane-scoped `--no-daemon` mode.
- Town's **+ Add room** is now a doorway in a fixed place in every building,
  just left of the bar, instead of a dashed slot after the last room. It no
  longer moves when rooms are added, moved or tidied; rooms keep clear of it.
- On a desktop, the search of Town, Board and Desk rests as a search icon.
  Clicking it, or pressing **/** or **Ctrl+F** (**Cmd+F** on a Mac), unfolds
  the search box with the cursor in it; **Escape**, or clicking away from an
  empty box, folds it back. A query keeps it open. Phones search as before.
- One running World owns its data folder: a second World on the same folder
  stops with a message naming the running one, instead of overwriting its
  files.
- The session signing key is always `session-secret.json` in the data folder.
  A World started with a custom `HERDR_WORLD_SETTINGS_PATH` creates a new key
  once, so its browsers log in again after the upgrade.
- Validate browser and agent commands through a service-owned verb registry while
  preserving existing permissions, acknowledgement flags and confirmation flows.
  Unknown browser methods are refused before contacting Herdr, and command replies
  include evidence of admission, durable storage or native dispatch when available.
- Board's host label is now a heading with the host's name and agent counts,
  followed by short lines for usage and each harness's limits, instead of one
  long line that ran past the host's zone.
- Build and run source checkouts with Bun 1.4.4 or newer; CI and native release
  builds now use Bun 1.4.4.
- Chat takes Town's look inside Town's windows, following the style guide:
  Town's colours and state colours, framed messages with yours in soft gold,
  raised keys, a soft gold Send and recommended answer, compact tables, no
  text under 11 px, and 44 px tap targets on phones. The composer's ⋯
  controls open in the same skin.
- Expanded or in Zen, Chat now uses the window's width as Terminal does. From
  900px wide the conversation fills the window (up to 1440px) as rows that
  name the sender, with the time at the right edge once per run of messages.
  Prose still wraps at a readable width; tables, code and tool steps use the
  whole row. A message another live agent typed in as `name: …` shows as that
  agent's, marked **relayed**. Phones and narrow windows keep bubbles.
- Scope PR checks to affected tests, contracts and platform inputs, while keeping
  the complete CI matrix on main and for unknown changes.
- Split long test and model jobs across runners, retain isolated latency checks,
  and expose leaf failures before the protected delivery aggregate completes.
- The command menu's key is `Ctrl+K` on Windows and Linux. In a terminal, the
  Chat composer or a text field `Ctrl+K` keeps its shell and editor meaning;
  `Ctrl+Alt+K` opens the menu from there, and from a text field it now opens
  it too. On a Mac `Cmd+K` likewise stays with a terminal or text field, and
  `Cmd+Option+K` opens the menu from there. Saved shortcut presets keep their
  keys.
- Town's reviewed marks for finished agents are now shared by every browser
  connected to the same World, so a completion checked on your phone shows as
  checked on your desktop. World keeps them in memory, so a restart forgets
  them.
- Chat's send bubbles and blue ticks now say, on hover, that World does not
  store them and that they are gone after a restart.
- The crew watcher starts a PR's review round as soon as a new head is pushed, in parallel with CI; green checks still gate READY and `crew/merge-ready`. When a fix, ci or conflict step is due and the author seat is busy with another PR, it starts a fresh fixer on the author's roster model in the PR's own worktree, which pushes, replies signed `[fixer #N]` and hands the PR to the next round.
- Share Desk review marks, observed stops and recent opens across browsers of
  one World service, preserving exact Undo and agent-session scoping. Desk state
  now lives in bounded service memory and clears when the service restarts.
- Keep shared review marks consistent across different receipt polling coverage,
  reject late mutations from replaced sessions, and keep keyboard focus on the
  next Desk card after marking a stop reviewed.
- Keep reviewed stops acknowledged after their display times expire, and notice
  later completed work through native state progress even while World was closed.
- Refresh receipts for newly detected stops, fence older in-flight reads, and
  prevent the preceding report from enabling Mark reviewed during refresh.
- The website film, "Promoted to CEO", now shows World 0.3.0 in 110 seconds:
  Town's reception on top and the bar, an agent dropped in the bin catching the
  bus, a new agent hired at the town center walking to its desk, fuel gauges
  with an agent out of fuel, and expenses boards. New scenes show thought
  bubbles with each working agent's step, a lens colouring the town by idle
  time and spend, the post office with a parcel for every pull request, and
  the Cmd+K command box finding an agent. A 3 AM question is answered from
  Needs you on a phone. In the morning the Town Master greets you with "Since
  you left" and N steps through what needs you, ending at a grumbling, napping
  reception crowd in a 291-agent town. It is still drawn live with Town's own
  code.
- Run static checks and affected unit tests for PRs limited to agent tooling and
  its runbooks, while keeping Delivery checks and protected platform reports.
- World downloads about 15% less before Town first appears. The Inspector and
  its file preview now load when an Inspector first opens.
- Reduce Herdr calls when reading Desk turn receipts while keeping the session replacement fence.
- By owner decision, the gate retains its pass, review, check and decision history indefinitely while deduplicating identical observation payloads. Automatic expiry and manual clearing are not available; a clearing affordance is deferred. `agent:crew status` reports the gate database size.
- Needs you items are compact notifications: one header row with the agent's
  mark, name, place and age, a chat icon (**Open in Chat**, or **Follow up in
  Chat** for finished work) and **✕**, which dismisses a question or marks
  finished work reviewed, each kind keeping its own action. Messages show two
  lines; **more** (or a tap) shows the whole message in place with its links,
  and **less** shortens it again; keyboard focus entering a clipped message
  reveals its links. Quick replies (with **Other…** for a typed answer) or one
  answer field appear only when the agent asked something. The agent's name
  opens its Chat on every item. Over Town the tab wears Town's look.
- On a phone outside Zen, **Needs you** in the top bar is an inbox icon with a
  count badge right after the view's name, like the Hosts icon.
- Town, Board, Desk, Chat and the phone bar use one set of agent marks and
  words: • Working, ! Needs you, ? Asks you, ✓ Done, – Idle or Reviewed,
  ~ No signal and × Offline. Board no longer marks an agent with no signal
  with **?**, which now always means an owner question.
- Reviewed is one record: marking finished work reviewed in Town, Desk or
  Needs you clears it in every view and browser.
- One vocabulary for the same things: Town's Summary says **Done, not
  reviewed** and **needs you**, Desk names an agent's **desk** rather than its
  tab, and Board calls a pane without an agent a **terminal**, as Town does.
- Refresh World with unchanged-host confirmations and reuse unaffected Town rooms
  and Board topology. Prepare only the mounted view within its Hosts/watch scope, with complete recovery after
  a service restart and unchanged host qualification and controls.
- Keep Desk review marks and recent opens, watchlist pins and checked completions
  across World restarts. Every browser shares committed state; saved records
  reappear only after World verifies the same terminal and, where known, session.
- Align React and React DOM with Roamgate at 19.3.1, fixing their development
  changed-prop diagnostic traversal so dense Board refreshes no longer stall
  terminal typing for seconds.
- Preserve terminal renderer ownership during pane switches and restore minimized
  Groups windows reliably with React 19.
- Town, Desk and Needs you now use only the shared Desk review record. Missing
  stop metadata refreshes before marking and remains retryable when unavailable.
- Upgrade preserves Desk/watch records and transfers old completion checks only
  with fresh matching terminal, known session and native completion sequence.
  Work without session proof may need review once again after upgrade.
- Keep keyboard shortcuts on the World service so they follow every browser.
- Start each browser on the connection it last used, keep recently viewed
  terminal streams warm for quick switches, and keep pull request badges across
  reloads and reconnects, shown as stale until checked.
- Reduce idle work across open World browsers by sharing focused observations,
  agent activity and Desk screen/turn reads in the service. Browser views refresh
  on changes and recover failed reads without repeatedly re-listing idle hosts.
  Older services retain the existing refresh timers.
- Store agent profiles and chimes in the World database, importing existing JSON
  once after a private backup. Profile edits, terminal import completion and the
  Town master revision watermark now commit through the single SQLite writer.
- Store Board notes, strings, appearance, layout, interest and relations in the
  instance database, importing existing Board JSON once with a private exact-byte
  backup. Existing Board, Town, Spaces and CLI behavior stays the same.
- Keep auto-sync last-run status in the World database, importing existing settings
  history once after a private backup. Background results no longer rewrite
  schedules or other configuration in the settings file.
- When part of the app fails to load after a service upgrade, World offers a
  reload instead of reloading the page by itself and replacing open terminals.
- Share terminal profile assignments and the Town master across Worlds connected
  to the same Herdr. Settings follow terminal moves and end with the terminal;
  legacy assignments migrate once with a backup and preserve newer settings.
  Master revisions learned during writes survive restarts, and removed
  connections retire their cached claims while offline hosts stay unresolved.
- Replace Town's floating **New room** button with a dashed **+ Add room**
  slot at the end of every building's rooms. It creates a room on that
  building's host, the new room takes its place, and the slot moves on.
- Town draws an agent in an unknown state awake and confused at its desk,
  scratching its head under a purple `??`, instead of dozing like an idle one.
- Town's room cards keep the room's full name at town zoom. The busy count
  comes before the desk count, and the waiting badge sits beside the status
  bar.
- A reception chip for an agent with no Herdr name shows the agent's room
  instead of its harness. Its tooltip names the room and desk.
- Changing a colour or pin in Town redraws only that building, so the rest of
  the town no longer reappears building by building.
- Town's **City expenses** billboard stands on the lawn above the town
  center instead of over it, so the whole town center shows. Reception boards
  keep clear of the town center, the post office, the billboard and each
  other at every zoom: a board that would cover one slides aside over its
  building, or hangs lower, below the center or the board in its way.
- A wide Town opens framed on the billboard, the reception boards, the town
  center and every building, centred, however tall the boards grow, with the park below off-screen; **−** from there shows
  the whole town.
- Town bus stops show everyone waiting: agents queue along the pavement in
  joining order, wrapping into a second row, with a **+N** board at the end
  past that. An agent put back walks home from the queue and the rest step up.
- Town tables can be picked up at the room-summary zoom, on phones by a
  press-and-hold even under a room summary, and with the mouse on desktop. A
  tap on a summary still zooms into its room, and a tap on a table still opens
  it.
- Town's town center stands at the top of the town, just across the first
  street from the buildings and centred over them, its front steps opening
  straight onto the pavement instead of a deep square, so it is a short move
  from any room. Buildings stand side by side with only the normal streets between
  them.
- **N** in Town no longer opens the next waiting agent's window; it moves the
  camera to it and opens Needs you at its item.
- Town's expense boards (the city billboard, each reception, the Town board's
  Economy and room cards) show at most one short caveat line under a figure,
  such as "partial · 1 host missing". Hover the line, or tap it on a phone, for
  the full explanations, including unattributed usage and a limited detail list.
- A room or table card's Economy today says "no price table" instead of a
  dash when no cost can be estimated, and "No usage data from this host" when
  the host's harness logs cannot be read.
- The bin at the bottom of Town and Board lights up while an agent is dragged,
  so a phone can drop an agent on it with a short drag wherever Town is
  scrolled, and Town no longer scrolls while the drag rests on it.
- Only Town's bin speaks of the bus: on Board and other views it reads
  "Cleaning up" with the count, and its tray says when they close.
- While an agent waits for the bus in Town, its seat fades into the carpet
  and crumbles, so the desk reads as going; a desk whose agents are all
  binned fades whole. Putting the agent back clears it.
- An agent put in the bin on Board walks out of its front door to its stop
  the first time Town shows it, instead of already standing there.
- Town fuel gauges and the phone chip show "seen <age> ago" once a limit reading
  is more than 15 minutes old, so an old level no longer looks current.
- Town buildings put reception at the top, under a front door onto the street
  above, and a bar in the bottom corner where idle agents rest. Every building
  has roads on at least three sides, and the last lot on the street grid is
  reserved for a town hall. Wide screens open on the hosts' buildings; **ALL**
  shows the whole town.
- Town has a road down its left side too, matching the one on the right: it
  runs from the top street to the bottom street left of each row's first
  building, at every size and on a phone, and the landscape starts beyond it.
- The Town board's counts use one short word per column, Busy, Waiting, Done
  and Quiet, so every label sits on one line and the numbers line up; room
  and table cards use the same labels.
- Search matches every word in any order and any case in Town, Board and
  Desk, and each result shows its type, place, status mark and, for a task
  match, an excerpt with the matched words picked out. Board's results float
  over the board instead of hiding under it, its count matches the list, and
  Down, Up, Enter and Escape work there as in Town.
- Starting an agent or a Terminal from **New agent** keeps the pressed choice
  marked busy and shows one **Starting …** line that says what World is doing.
  After 10 seconds of real waiting it reads **Taking longer than usual**; there
  is no progress bar, and the icon stays still with reduced motion.
- A new agent window that opens on Terminal before Chat can read the agent now
  says Chat is not available yet under its header, with **Stay on Terminal**.
  Waiting announcements remain outside busy content so their updates can be announced.
- Store agent questions, answers, task results and attention delivery in the
  instance's private `world.sqlite`, with a backed-up, idempotent JSON import.
  The service owns ask alerts; interrupted sends retain explicit delivery
  uncertainty and answers remain available through `ask get` after restart.

### Removed

- Town's Needs you rail. Its questions, waiting agents and Outbox route are in
  the Needs you tab; Summary still lists and answers questions.
- Retired the separate completion-check browser APIs. Unresolved old receipts
  drain privately on confirmed terminal absence or 30 days after upgrade.

### Fixed

- Town rooms resize to fit their remaining desks when tabs close.
- Update DOMPurify and undici to include Roamgate's security dependency fixes.
- Keep the last known PR/MR status visible after failed refreshes and resolve the
  rebasing branch's request while a rebase is paused on detached HEAD. Clear retained
  status when its host, runtime, workspace, checkout or branch changes.
- On a phone, a partly expanded Town room's **+**, **» +N** and **«** Fold
  tiles are each at least 40 pixels square and sit side by side without
  overlapping, so each is one easy tap.
- Keep healthy World hosts fresh and actionable while agents animate their
  terminal titles, including repaints with reordered metadata keys, avoiding
  Town's repeated **Stale · Reconnect** flicker.
- Town's **+** (Zoom in) button works at every desktop window size. At some
  window heights, where the whole town is only a little wider than the home
  view, each press flew back to home instead of into the nearest building.
- Refresh Chat and quest usage-limit stops after rapid local transcript rewrites,
  even when the file size and timestamps are unchanged.
- Show agents' quests on Town desks and Board cards again. Since a refactor on
  2026-10-23 the service passed quest reads to Herdr, which refused each one and
  logged a warning every five seconds per connection.
- A test run no longer rewrites the installed World's signing key, which made
  the agent CLI's token stop working and could log browsers out.
- Recheck CLI authorization when held or queued work reaches dispatch, so stopping
  the CLI service prevents new effects even while its host remains connected.
  Finish history/undo records for effects already applied, and restore a Board
  edit after a rejected history write only if no newer edit superseded it.
  Classify page-key input and file-manager launches as opaque
  effects, and PR/link lookups as reads.
- Keep a large Board in its overview while it opens on a busy device: a frame
  arriving while the Board builds no longer leaves the overview with no cards
  shown before placement.
- Open the Board with one fewer render.
- Avoid unnecessary Board renders when toolbar measurements leave its controls
  unchanged, including the initial phone layout.
- Keep the dense Board's first overview and visible cards stable when an early
  frame arrives before initial layout placement.
- Batch status squares in dense rooms and across large boards with many small
  rooms to keep terminal input responsive, preserving each pane's status and
  the status-pulse controls.
- Keep animated Town input responsive in dense snapshots by skipping empty
  question lookups and yielding automatic Town-master name searches between batches.
- Keep the Inspector pane map open when a delayed terminal-focus handoff runs
  after keyboard opening.
- PR evidence captures wait for the current Town, Board or Desk scene to draw
  after assets and layout, fence viewport changes, and reject incomplete output.
- Recover captures after an unresolved asset is removed or replaced, and apply
  content sanity expectations in populated PR capture consumers.
- Chat submits a multi-question Claude Code form from its review instead of
  sending you to the Terminal, confirms the last answer, and lists every
  question's header with whether it is answered.
- Focus the message input when opening or returning to Chat, so you can type
  immediately without clicking the composer.
- Keep focus in the Desk queue during previews and in another input or newer
  window when an older Chat loads or its agent session changes.
- Show and answer numbered Codex question choices in Chat, including prompts detected by Herdr 0.9.5 without Codex hooks.
- Answer Claude Code text options and plan feedback from Chat with a checked native text destination, while preserving native drafts even after the cursor moves away.
- Keep text-answer refusals visible after question reloads and wait for asynchronous working or completed-turn evidence before confirming a discussion reply.
- In Town, Board and Desk, open local source references from Chat in the same
  Inspector's Files view at the requested line, using its selected agent
  worktree and host. Unavailable
  bindings and paths outside that worktree offer an explicit worktree choice.
- Keep commands and lists linked to their individual source files, while ordinary
  dotted prose and code identifiers remain text.
- Apply Chat text size to agent replies as well as user messages.
- Keep Chat paperclip uploads working when browser sync reconnects while the file
  chooser is open or between files in a multi-file selection, provided the same
  conversation and runtime still own the draft. Refuse a changed target before
  uploading remaining files, retaining completed paths in the original draft.
  Retire queued dispatch when Chat's owner is replaced, while preserving begun
  results and explicit Retry after reopening the same conversation.
- Keep Chat usable when the agent's worktree changes while it works. Chat's
  message box and its controls no longer stop responding after a while, and
  Chat no longer says **Disconnected** when it is connected; only Files,
  Changes and Commits wait, marked **Worktree changed · Showing last
  observation**, until the worktree is read again.
- Claude limits no longer jump backwards when several Claude sessions run:
  within one limit window World keeps the highest reading, and starts fresh
  when the window resets.
- Installer and update output says a harness integration was installed when it
  is new, updated when World changed it, and already current when nothing
  changed, instead of "updated" for every harness.
- The installed World skill now says World installs it automatically and how
  to remove it, instead of asking for an explicit install command.
- Show Claude's questions whole in Chat and Needs you, from its own record:
  every question, header, option, description and multi-select, instead of a
  clipped screen tail. Answer buttons appear only when the terminal shows the
  same question; otherwise Chat says why and offers the Terminal.
- Show an unrecognised prompt as the terminal draws it, with the reason Chat
  does not answer it, keeping the final prompt row in view. Keep history read
  errors visible beside question cards, and refuse malformed or mismatched
  transcript questions without discarding their authority checks.
- Keep folder-trust safety text and warnings visible in Needs you. Refuse
  clipped folder dialogs and changed literal folder text, preserve paired globs
  in question matching, and keep failed transcript reads Terminal-only.
- Cancel pending Desk reveals permanently when leaving the view, unmounting or
  starting a newer reveal, including queued Inspector admission. Superseded
  requests leave current agents available to retry without an unavailable error.
- Keep a reviewable stop for agents already finished when World first sees them,
  and retain it after the 12-hour display window expires. Current stops no longer
  disappear at 500 agents; bounded history yields before current metadata.
- Prevent unknown-session Desk reviews from following a replacement agent or
  inheriting unproven ownership after restart. Known sessions restore their exact
  reviewed stop after fresh verification.
- Preserve current known stops while reconnecting, retain replacement fences
  across restart, and refuse oversized or malformed native observations without
  partial current changes or stopping World.
- Prevent saved answers and owner alerts from sending to a replacement Herdr
  after World restarts. Preserve possible-send uncertainty and saved history;
  retrieve saved answers with `herdr-world ask get ID`.
- Reserve new question, answer, result and history IDs durably so retention and
  service restarts cannot make an earlier ID available for another record.
- Keep a tab name or status you start typing when another device's change
  arrives at the same moment; the draft was replaced by the shared value.
- Keep the pane map in a window's title open when it is reopened just after
  picking a pane; the picked terminal's late focus closed it.
- Check the proposed merge against main's file-size ratchet before pushing,
  including stacked targets, and validate PR descriptions locally with
  `bun run check:pr-body <file>`.
- Keep the GitHub source connected when many pull requests merged in the
  window: merged history is read fifty at a time, apart from open work,
  instead of in one request that GitHub stopped with a timeout.
- Read open pull request searches separately and action details before history.
  History is bounded to 400 pull requests within the existing minute; an
  oversized or timed-out history keeps the last complete list and explains
  how to shorten the merged window. A pull request merged between requests
  keeps its merged state and date, together with all its roles.
- Reduce Interest overhead in dense views when there are no effective Focus claims.
- Keep Group Add, Edit and Roles drafts after conflicting edits, require explicit
  review before resubmission, and refuse replaced or ambiguously named agent selections.
- Keep reviewed Room/Desk moves valid across incidental status, focus and revision changes.
- Preserve live appearance edits when RPC or CLI moves a desk.
- Preserve appearance edits and resets saved at a move's new destination, and
  describe whole-Board form conflicts without claiming that the current Group changed.
- Reuse existing Herdr installations instead of requiring a second Homebrew-owned
  runtime. Homebrew installs a missing verified prebuilt Herdr on first normal
  World launch, outside its keg, including on Intel Macs without a source build.
- The standalone installer now installs Herdr only when missing and leaves existing
  versions and installation owners unchanged. Explicit upgrades remain available.
- A failed Homebrew runtime check or download warns and still starts World, keeping
  SSH profiles and in-app setup available. Fresh standalone installs leave harness
  integrations and the plugin to an explicit `herdr-world herdr upgrade`.
- Preserve Herdr even if another installation appears during automatic setup:
  missing-only bootstrap never upgrades or overwrites an intervening runtime.
- Keep safe standalone runtime setup when selecting an older World release that
  lacks the missing-only CLI option. Report broken Herdr links before downloading
  and preserve the blocking entry for its owner to repair.
- Validate the selected Herdr file before treating discovery as an installation;
  preserve unusable entries with repair guidance. Reuse a reachable Herdr server
  without installing a second copy when its executable is outside the installer's path.
- Show every pane of a multi-pane tab, such as a review round, in its desktop
  terminal window. Herdr reports a tab that no client shows at a few cells,
  with some panes 0 cells tall; World now draws such a tab's split from its
  ratios instead of showing no layout.
- Finish standalone installer upgrades by bringing Herdr, detected harness
  integrations and the installed World plugin up to date, then restarting the
  matching running World service on Linux and macOS. Report every step and explain
  skipped restarts; `HERDR_WORLD_SKIP_HERDR=1` still permits the World restart.
- Retry transient local Herdr connection failures with capped backoff so a runtime
  that starts after World can recover automatically. Explicit Reconnect remains
  available, and failed topology stays non-actionable until freshly observed.
- Reject Markdown link and image URLs that hide unsafe schemes with controls or
  use mixed slashes to address another origin. Preserve ordinary links and
  workspace source-file navigation. Adapted from [Roamgate #567](https://github.com/powerfooI/roamgate/pull/567),
  commit `ded99da2f6ccf8ed3fa85ae29e27011598ec4b04`.
- Show an empty Chat for a newly started agent without a conversation yet,
  while retaining errors for missing or unreadable conversation records.
- Keep New agent progress and outcomes visible above harness checks, and
  prevent repeated clicks or a startup timeout from creating duplicate agents.
  A definite failure allows a deliberate retry.
- Ignore replies from a dismissed New agent window and finish opening a login
  tab before accepting another start, preserving the active attempt's result.
- Open agents on Terminal until Chat can show their conversation, including
  when a session exists but its record is unreadable. Switch to Chat only when
  it becomes available, unless a view was chosen manually. Show unavailable
  explanations only in manually selected Chat. Describe startup questions honestly and
  show plain starting/waiting guidance instead of an installation hint.
  A replacement terminal or harness cannot inherit the old automatic switch.
- Keep rapid repeat clicks and taps on a notification’s close button from dismissing
  a Needs you item or activating another control exposed beneath it.
- The welcome card names Town, Board, Desk and Spaces instead of retired
  views, and Town's empty state points to **Hosts → Manage connections**.
- A ready runtime suppresses Town's local Herdr setup offer even when hidden
  by the **Hosts** filter.
- Name the asking agent in the **Needs you** list as Town labels its desk, with
  **Open agent**, and in the new-ask notification by its Herdr name (else its
  pane) with the question's first line.
- Bring an unverified ask to reception, marked unverified, when exactly one
  local Herdr has the pane it names, instead of leaving it in the list only.
- Restore browser startup when owner questions load before the application store,
  while preserving their chime, toast and OS-notification behavior.
- Explicit Herdr setup now registers future user-service startup even when Herdr
  is already running, preserving the live server and reporting registration errors.
  Unusable executable entries are rejected before service registration and preserved
  for repair.
- Preserve other hosts' disconnected state and notice revisions while marks commit.
- Refuse pending Desk/completion commands across observed session replacement,
  including unknown identities, and let exact Unpin remove unavailable saved
  watches without deleting a newer replacement.
- Remove the current shared watch projection when an older exact Unpin names the
  same saved watch after a runtime change.
- Enforce legacy-review expiry at the resolving Desk write and retain a receipt
  when sparse or duplicate metadata cannot name the exact displayed stop,
  including when opening another report before the next complete observation.
- Keep Ranger task recovery stable across equivalent configuration key order and
  reject navigation replies from a retired service or runtime.
- Preserve dynamic task membership, proposals and run omission notices across
  restart, and refuse unproven or stale Claude continuation identities.
- Keep SSH command traffic responsive with private runtime-owned shared connections,
  bounded background work, keepalives and clear refusal of oversized Herdr requests.
- Cancel queued SSH commands, workspace Files uploads and terminal uploads when their runtime retires; retain failed-start
  master ownership until confirmed exit and keep recovery within caller deadlines.
- Keep file-ignore checks, launcher discovery and integration-version checks on their
  owning connection when it disconnects.
- Refresh worktree Git status in the background without overwriting newer host-local
  updates, and batch untracked-file line counts.
- Keep Pane Search's selected match when moving through results with arrow keys.
- Keep unsent Message drafts across a reconnect to the same destination, in
  memory only.
- Return clipboard writes from composer-sent commands to the sending browser,
  send uploaded image paths so Claude Code attaches the image, keep password
  managers off search fields, and open a plugin popup on its own Space.
- Retire earlier transcript claims when a Codex title names a different thread,
  including a transition from a reported session; preserve matching-thread claims
  under a stale native report. Keep runtime replacement from borrowing a previous
  terminal's session or checkout.
- Retain PR-link evidence omitted from a successful truncated GitHub page, while
  retiring claims when their runtime or connection ends.
- Keep agent recency current through status transitions and retain the newest
  timestamp when a list reply races an activity update. Replaced agent sessions
  never inherit their predecessors' recency.
- Preserve the same agent session's recency across a World service restart, and
  ignore pushed activity when the service disables shared acquisition.
- Keep bound appearance from attaching to a reused Herdr tab or pane ID, and
  preserve choices through confirmed moves without changing runtime status colours.
- Keep the latest explicit colour or reset through lost move acknowledgements,
  whether edited before or after native close cleanup; bind profile colours to newly launched terminals on reused IDs.
- Reclaim closed terminals' appearance settings from complete current evidence,
  and discard unsaved phone drafts when their pane moves into a different tab.
- Retry closed-tab colour and pin cleanup after concurrent Board edits, without
  removing a replacement tab's settings.
- Keep an unverified question unplaced when any candidate local Herdr cannot
  confirm whether it owns the claimed pane.
- Bound retained payloads while Board edits wait for earlier commits, preserving
  small metadata updates from dense World observations.
- Opening World, or an agent's window on Chat, no longer resizes the agents'
  terminals for every other viewer. A terminal World keeps hidden attached to
  a pane at 13×1 and shrank it to a sliver, and World's popup watcher shrank
  every pane to 80×24. Both now attach at the size the session already has,
  so harness menus such as Claude Code's or Codex's `/model` draw normally and
  Chat can read them.
- A terminal another client squeezed (for example an older World page) is
  never kept that small by World: a hidden terminal uses its last good size
  instead, and showing or clicking the Terminal view gives the agent its full
  size back.
- Show a Town building's stale roof as soon as its host goes stale, instead of
  after an unrelated change redraws the town.
- A desk or agent carried in Town over an agent walking past now lands on the
  room or desk drawn under it. It no longer turns into a reorder in the walker's
  own room, snaps into a group with the walker's desk, or moves an agent to the
  walker's desk. An empty chair whose agent is walking elsewhere now selects
  and drags its pane, not the absent agent.
- Show a Town desk's agent name when exactly one named agent occupies its tab.
- Keep Town city and building expenses consistent when many agents produce usage:
  detail limits preserve totals, seven days includes today, and the Town board's
  Economy today shares the city board's UTC harness usage and price-table rule.
  Preserve valid pane attribution during partial log scans and activity-title
  changes; label unattributed usage as already included in totals.
  In the `town-scale` preview, use synthetic usage for every economy reader,
  including reception, city, room and table cards, the Spend lens and Town board;
  label it as test data instead of mixing live totals with synthetic buildings.
- Use clear, tabular digits for Town economy amounts, including city and
  reception expenses, room and table cards, and compact phone signs, so 5 is
  distinguishable from S and 8.
- A desk held at the edge of Town to scroll no longer snaps into a group when
  frames come slowly (a large window on a busy machine). The grouping wait
  starts only once the desk is held away from the edge.
- A desk held at the edge of Town to scroll no longer snaps into a group with
  a desk that scrolls under it; the grouping wait starts once the town stops.
- Avoid scanning Town's agent and terminal rosters for the Summary when there
  are no open questions, reducing unnecessary work during dense refreshes.
- Expanded Town rooms now shrink to fit remaining desks when tabs close while
  staying expanded.
- A Town bus stop's countdown now runs to the bus reaching that stop and reads
  "due" only a few seconds before it pulls in, instead of from the trip's start.
- An agent put in the bin in Town walks out of its front door and along the
  pavement to its stop on a phone too, instead of appearing at the stop when
  its walk indoors took longer than 15 seconds.
- Stop Town from redrawing covered or off-screen ambient animation. Visible
  motion keeps its smooth cadence, and static scenes wake when their state changes.
- Repaint a sleeping Town after GPU context restoration, including when returning
  from a hidden page.
- Stop idle Town from re-rendering the whole World page on every animation
  frame. An idle Town now renders only when its data changes, which saves
  battery on phones and frees the main thread for input.
- A Town viewed whole stays whole when it grows, when a panel narrows it, and
  when you come back to it after a different screen shape.
- A Town agent that starts walking inside its destination tile now stops at
  the tile's centre instead of where it stood.
- A desk carried in Town no longer snaps into a group during a zoom or camera
  flight when frames come slowly (a large window on a busy machine). The
  grouping wait starts once the town is still.
- The Town board counts the whole town: quiet agents now count, and a line
  gives every agent in every building, so a building whose agents are all
  quiet no longer goes missing from the board.
- Keep large Worlds responsive: a refresh no longer rebuilds the focused host's
  World in the shell's render. Host filters reuse the World's index, Town
  indexes each room's tabs once and yields inside large rooms, and terminal
  colours are derived again only when the Board or the hosts change.
- Town presses land on what the screen shows: a press right after a pan that
  has not been drawn yet (an arrow key, or the edge scroll while carrying a
  desk) no longer misses the desk under the finger on a slow device, and a
  carried desk aims at, and drops on, what is drawn under it while the town
  scrolls beneath it.
- Keep Town Reception and lounge agents aligned with their current building after snapshot updates, including updates during a stand-up animation.
- Town's search reads above a lens: with a lens on, each match is outlined
  over the lens's colours and the chosen one pulses there, while every other
  room keeps its lens colour. Escape ends the search and leaves the lens on,
  as it was before.
- Keep Town whole when desks, rooms or hosts appear or disappear: the old
  scene stays drawn until the new one is ready, new buildings fade in, removed
  ones fade out, moved buildings glide with their plaques, and the camera keeps
  what you were looking at in place. Reduced motion makes the change instant,
  still without a blank or half-drawn frame.
- Town draws one wall around a team's touching tables, bending it around
  another team's table instead of splitting into a box per table. Separate
  clusters of one team in a room get a wall each, joined by a connector.
- Joining a team in Town moves no other table: the dropped table takes a free
  place touching the table it was dropped on, on the side it came from where
  it can, so an L built table by table keeps its shape.
- Keep verified source bindings across service restarts and refuse ambiguous Board
  note targets while retaining the existing layout, appearance and interest rules.
- Preserve appearance and interest records when a listing repeats a pane, terminal
  or known session identity, and prevent split tabs from inheriting an arbitrary
  earlier appearance identity.
- Keep Town's window controls at least 40px on touch tablets and without a
  pointing device, including narrow columns, without overflowing the header.
- Recover saved World effects with current attempt fences and authorization,
  preserving uncertain sends, original recipients and operation versions across
  restart. Owner alerts retain safe retries; saved answers require an explicit
  owner decision before a possible duplicate send.
- Configuration → Integrations reloads by itself after World restarts or a
  connection's Herdr runtime changes, instead of saying the host is no longer
  available. It suggests updating Herdr only when Herdr refuses the
  integration methods.
- Configuration opened from Town, Board or another World view uses the
  active connection it names. Integrations and Connection settings no longer
  stay stuck waiting for Herdr when nothing is selected or the selection is
  on another host.

### Documentation

- Bring the README, tutorial, feature guide and website up to date with 0.2.7.
  The README gains a "What's new in 0.2.7" summary and a Chat guide link. The
  tutorial gathers Chat into one **Chat with an agent** section that covers
  the composer, the Now bar and Stop, tool evidence, receipts and answering
  prompts, and fixes earlier steps that said Enter sends a message. The website
  gains a Meet Chat section and says when World installs Herdr.
- Distinguish the published 0.2.7 standalone install/upgrade behavior and opt-out
  from Homebrew's missing-only setup and the unreleased source installer fix.
  Match Chat's Configuration path, transcript-tail tool call and receipt labels.
- Recapture the README, tutorial and website screenshots for 0.2.7 with real
  Claude Code agents in disposable workspaces, and add desktop and phone Chat
  captures in place of the History capture.
- Rewrite the tutorial for people learning World: eight short chapters of
  numbered steps that say what to do and what you will see, about a quarter of
  its former length. Reference detail lives in `FEATURES.md`, and the site
  build now fails when a tutorial step or the whole tutorial grows past its
  limits.
- herdr.world now presents World 0.3.0: how Needs you, thought bubbles, the
  fuel board and expenses, search, the post office and the bin help you run a
  crew of agents, with new Town and Board screenshots and sharing images drawn
  from a synthetic scene by `scripts/site-screenshots.ts`.

## [0.2.7] - 2026-10-26

### Added

- Add a Chat tab to the Inspector, replacing History. Chat shows an agent's
  conversation from its transcript, never the terminal, and replies with
  Herdr's agent prompt only to a session Herdr ties to the pane. The service
  pushes a change notice when the transcript, title or status changes, so the
  browser never polls. Unavailable conversations explain why and offer the
  matching action. The service offers one conversation read model
  (`agent_conversation.get`, `.latest`, `.send`, `.watch`), and
  `bun scripts/chat-conformance.ts` checks the readers against this machine's
  real transcripts.
- Installing or updating Herdr World now installs or upgrades Herdr to the release
  that World version verified, in Herdr's default location, and installs the Herdr
  integrations for the Codex, Claude and Pi harnesses present on the machine. The
  standalone installer and `herdr-world update` run the new
  `herdr-world herdr upgrade`. In the browser, a World update follows up with a
  visible Herdr step, and **Runtime → Upgrade Herdr** (or **Update Herdr
  integrations**) appears whenever something is behind. The upgrade verifies
  checksums and versions before replacing anything, keeps the old binary for
  rollback, and never downgrades. It hands a running server's panes to the new
  version only when it can prove nothing supervises that server (Linux);
  otherwise it says that a restart is needed. A GitHub-installed Herdr World plugin is pinned to the
  matching release tag. Windows uses Herdr's own installer and moves a Herdr that
  older World releases installed to Herdr's default location. The Homebrew Formula
  installs Herdr too, using the verified prebuilt binary on Intel Macs. Set
  `HERDR_WORLD_SKIP_HERDR=1` to install World alone.
- Choose Watching, Muted or Focused for each agent from the button beside its
  name in the Inspector. Chimes follow it: a muted agent stays silent but still
  reaches reception, and while a focused agent is reachable only focused agents and the
  Town master's needs-you chime. World keeps the choice for the agent's
  terminal on every device and drops it once the terminal closes, including
  closes missed while disconnected, retrying if settings change during the
  listing. The control works in Town, Board and
  Spaces, and reports a failed save so it can be retried.
- Agent profiles: name, home room, role, colour, harness and model, Codex
  reasoning effort, permission mode, skills, tools, a starting brief and a
  Town look (skin, hair, outfit including a dress, colours and an accessory)
  with a live preview. Reviewer, Builder, Designer and FirstMate are editable
  starters. Open them from Menu → Agent profiles, the Actions menu, the launcher
  or Board.
- **New agent** (in the Actions menu, on each Town room's plaque including on
  phones, beside **+** in Spaces, and in Board's New tab dialog) starts an
  agent in a new tab from a profile in one tap, or any agent kind the host's
  Herdr supports. A profile becomes the
  harness's own configuration at launch (a Claude Code subagent definition, or
  Codex options and developer instructions), the tab takes its colour and the
  agent wears its look in Town.
- The launcher shows whether each harness is installed and logged in, using the
  harness's own status command, and **Log in** opens a small tab and shows the
  harness's own login command to run there. World never sees or stores
  credentials.
- Show each agent's quest: read without a model from its own todo list
  (Claude Code `TodoWrite` and tasks, Codex `update_plan`, Kimi
  `SetTodoList`), approved plan, Codex goal or `/loop`. Chat shows a foldable
  quest log above the conversation, Town shows a progress flag over a seated
  agent, and Board shows a progress chip on the agent's card. The new
  `agent_quest.list` RPC returns quests for many panes at once.
- The agent-settings popover (click an agent window's icon) links to the
  agent's profile: **Edit profile** for the profile it was launched from, or
  **Profiles…** to open the editor.
- Group agents that know each other. An agent stamped as spawned by another
  (`herdr-world stamp CHILD PARENT`, or Board's Start an agent from a note
  strung to a pane) is joined to it automatically: a wall and connector in
  Town, a string in Board, and its parent's colour unless it has its own. Rest
  a dragged Town table on another table until it snaps, or drop a Board tab on
  another tab (or use **Group…**), to group them; Town also seats the tab
  beside its teammate in Herdr; **M** on a focused Town table offers
  **Group with…** and **Leave the team** too. World keeps the groups and the
  last spawn claims it saw, shown stale while their host is offline, and drops
  them once their agents have closed.
- Chat shows compact pull request cards beneath an agent's known PR announcement
  or current work claim. Open the details to inspect CI and reviews; **Ask the
  author to fix** sends a `↳ #N` message when this conversation owns the claim.
- Chat's Now status uses a small state circle, with its status word available
  to screen readers and on hover; reduced motion keeps the working dot still.
- Chat now uses the full shared Compose editor, attachments and harness command
  palette, opened by typing `/` or from the **⋮** controls menu. A paperclip
  attaches files. The paper-plane button, Ctrl+Enter or Cmd+Enter sends;
  the enabled Send button has a yellow background. Enter adds a line, with
  drafts kept per conversation. Slash commands have honest unchecked receipts, and native
  working-state sends show queued bubbles until their transcript receipt.
- The current quest takes one slim title/progress row inside the conversation;
  expand it for objectives without adding a fixed toolbar.
- While reading back in Chat, the existing catch-up button counts new agent
  messages and clears at the bottom. Own messages and queued bubbles do not count.
- **Chat text** in Configuration sets Chat's text size. It follows the
  terminal font size until set on its own, and Chat's text is a step larger
  than before (13px).
- Chat loads earlier messages as you scroll back past the latest 200, a page
  at a time, keeping your place; **Load earlier messages** does the same.
- **Chimes.** World plays its own chime for a change that needs you: a sound
  for who (the Town master, the crew or the agent's profile) and a pattern for
  why (needs you, for you, finished), with a toast that says both. **Menu →
  Sounds** sets this device's chimes, the shared sounds and patterns, and the
  Town master, whose needs-you chime breaks Focus. Profiles get a **Chime**.
  Bursts share one chime; World's notifications go silent while it chimes.
  Queued sounds follow current settings, intentional silence stays silent
  during OS fallback, and device mute silences push while World is open.
  First-install notification control works without reloading; unknown senders
  keep the crew sound through the server relay.
- Show per-host running Herdr version, protocol, compatibility and expiring
  check time in Manage connections, with an explicit retry. Keep installed-binary
  identity separate and unverified upgrades explicitly unavailable.
- Chat answers an agent's own permission prompt. For Claude Code's permission
  box and Codex's approval menu, Chat shows the complete request, the question
  and each option; picking one (or its number, with the card focused) presses
  that key in the agent's pane after checking the prompt, session and state
  have not changed, and Chat shows what it sent. It says "You answered" only
  when Herdr shows the agent moved on, and otherwise why it cannot confirm.
  Herdr cannot hold a prompt between the check and the key, and the card says
  so. Any other prompt offers the Terminal instead of a guess.
- Chat answers Claude Code's own questions as well as its permission prompts.
  A question form's choices (with the description under each), each tab of a
  multi-question form and its review, and plan approval appear on the ask
  card, and a digit picks one. Options that open a text box, and unnumbered
  menus, stay in the Terminal. The same checks, receipts and known issue
  (#284) apply as for permission prompts.
- Chat shows what an agent is doing now: a Now bar with its status, the task
  from its terminal title and the time since it changed, and the tool call
  running now with its command and its own timer. Stop, or Esc pressed twice,
  interrupts Claude Code, Codex or Pi; Chat never stops an agent by itself.
- Chat's tool rows show what each call did: a plain label ("Run reconnect
  tests", "Edit reconnect.ts"), how long it took, and a pass or fail badge for
  a test run. A run whose tests failed reads as failed, and a call cut off
  without a result reads as interrupted. Opening a row shows the edit's diff,
  a green or red test strip with the first failing test, or the end of its
  output, with credentials redacted.
- Workspaces and hosts have their own colours, saved with terminal colours.
  Pick a workspace's colour from the swatch beside its room's name in Town, its
  card in Board or its menu in the Spaces sidebar: it colours the Town carpet,
  the Board card and a dot in Spaces, and the workspace's tabs without a
  colour of their own. Pick a host's colour on its Town reception board, its
  Board zone label or its Spaces header: it colours the building's roof, the
  Board zone and the header, and is not passed on to tabs.
- Pin a desk in Town from the agent window's **⋯ → Pin desk in Town** menu
  on desktop or phone, or a card on Board with **Pin** in its selected bar.
  A pinned desk or card shows a pin and keeps its place through reorders, room
  growth, Tidy and settling. Town applies a saved pin only while its tab is
  admitted by the room's native-order visible prefix; expand to reveal a hidden
  pinned desk. Agents at a pinned
  desk never go to the lounge: they visit reception only when they need you or
  finish, and walk straight back once seen. Pins are saved on the World
  service, so every device sees them.
- Town summary: the Town board's **Summary** button (on a phone, its counts
  chip) opens a window listing who needs you, unreviewed finishes and when
  each was last active, every host and room with its counts, and spend per
  model. Open questions use the reception tray's answer cards; the sign,
  chip, tray and window share one needs-you count of blocked agents plus
  open questions.
- Agents can change World themselves with the `herdr-world` CLI;
  `herdr-world --skill` prints the agent guide. Agents colour, pin, move and
  group Board cards, reorder Town desks (`--herdr`, through Herdr's tab
  order), stamp their own spawn (`spawned-by`), report task results
  (`result`) and ask the owner questions (`ask … --wait`), which appear first
  in Town's **Needs you** list for an answer. World checks that a caller runs
  in the pane it names, records every change with its actor and time
  (`history`), and can undo World-side changes (`undo`). JSON output when
  piped and stable exit codes.
- Your open pull requests get a card in Work with CI on the head, each rev
  agent's latest result and your merge rules (not a draft, findings confirmed,
  CI green, mergeable, screenshots for UI changes), each ✓, ✗ or unknown.
- Merge (a merge commit pinned to the head you saw), close and mark ready from
  the card, each behind a sheet that says exactly what happens; GitHub's
  answer shows on the card. World never bypasses branch protection: while a
  review is required it offers Open on GitHub and the merge command instead.
- Tap a pull request's badge on a Town desk to open the same card.
- Cards say **Ready to merge** when every rule holds, and **Stalled** when CI
  failed on the head and its agent is idle.
- Show GitHub pull requests and Jira tickets beside your agents, built in and
  on by default. Board's new **Work** lens lays pull requests out from review
  through fixing, green and ready to merge to merged, and tickets by status;
  each card names the agents working on it. Town desks show the badge of their
  agent's pull request or ticket (`#123 ✓`). GitHub uses the service user's
  `gh` sign-in; Jira Cloud takes a site, email and API token in **Settings →
  Sources**, where each source can be switched off. The token stays in private
  service storage, never reaches the browser and is removed when the site or
  email changes.

### Changed

- Show a terminal's colour as a swatch beside its name in the terminal's
  header on desktop and phones, and offer the same picker under **Colour** in
  the terminal window's menu and in the Town peek's header. All pickers are
  one component with **Default colour**.
- Show attachment uploads in every composer that attaches files: the phone
  Composer, Spaces, the Town peek and Inspector Chat (which can now attach).
  Each file has a chip with byte progress, then done or failed with Retry and
  Remove; Send waits for uploads, a file picked again while it uploads is not
  uploaded twice, picking a failed file again retries it, and a path that
  finishes after its composer closed joins the draft when it opens again.
- The Town peek shows the agent's latest message from Chat's conversation read
  model, rendered as Chat renders it, instead of terminal text, and has **Open
  terminal** in its header, and refreshes when the conversation changes rather
  than polling. Tapping an agent's table opens its peek too, and opening an
  agent brings it back to its desk until its status changes. **Menu → Town
  opens** chooses Chat (the default) or Terminal for these taps; neither marks
  finished work reviewed.
- Town tables follow Herdr's tab order, so moving a tab in Spaces or Herdr
  moves its table. Drag a table onto another in its room (or press **M**) to
  reorder it: Town sends Herdr's `tab.move` the way Spaces does and shows the
  order Herdr reports. World now listens for Herdr's `tab.moved` event, so a
  reorder made anywhere updates every view.
- Give every terminal one colour, shown as its tab in Spaces, its table in
  Town and its card in Board. Tabs start with a stable default; a colour chosen
  from the Spaces tab menu, a Town peek or Board is saved by the World service
  for every device and can be reset. A tab moved to another room keeps the
  colour it showed.
  Town's table nameplates now sit on the table's front edge, and agents are
  drawn larger.

- Reject pending Ranger follow-ups after their chat changes and deduplicate
  concurrent queue retries after scope capture. Remote Codex History and session
  linking no longer require Python 3 on Unix SSH hosts.

- Refresh Roamgate source through `1a81c5da` after v0.8.7: add History chat and
  shared conversation minimaps, workspace PR/MR status, Inspector refresh and
  commit navigation, explicit Codex session linking and remote transcript lookup,
  and mobile notification banners. Retain World runtime ownership and navigation.

- Refresh Roamgate source through main `57327a0d` after v0.8.6: add Ranger
  Steer/Queue messages, collapsible model reasoning and selection-safe terminal
  repaint focus, plus clearer Message/Direct switching and shortcut visibility.
  Queued questions retain their selected runtime and hold on replacement.

- Synchronize the Roamgate v0.8.6 source: add login-token help, symlinked user
  config roots, pane dragging across tabs, tab-strip overflow controls, and
  repository comparison branches. Keep World's qualified terminals, mobile app
  bar and managed-window tabs. Update the optional Herdr setup target to 0.9.5
  with verified release checksums; terminal protocol remains 22.
- Each agent has one window. Tapping an agent or its table in Town (or
  activating it, the needs-you list, **N** and **Next**) opens its Inspector on
  **Chat**, the existing Chat view with the full conversation, **Jump to
  latest** and its composer, instead of a separate peek chat window; a hover
  card stays as a preview. Town's Inspector docks right by default (**Inspector
  opening** now defaults to Snap right) and keeps the dock each window was left
  with. The top selector puts Chat first and follows the window's own width:
  labelled, then icons, then the active view with the others under ⋯. The Town
  master's chat (**Menu → Town master**, `firstmate` by default) opens docked
  on wide screens. On a phone the Chat view no longer shows the terminal key
  bar.
- Rework the website film around today's World: Town is the hero (rooms and
  nameplated desks, reception with ✓ and ?, the lounge), an agent's peek and its
  chat, docked beside Town, answer it, Board shows the same terminals as cards and
  strings, and the phone scene replies in Chat. The film paints Town with the
  app's own Town code instead of the retired Office's Claw-Empire sprites, adds a
  text version and spoken captions, and with reduced motion cuts instead of moving
  the camera. Full screen turns a phone to landscape where it can, and fills the
  window on iPhone. New poster image.
- The film page now plays a video recorded from the live film (WebM VP9 with an
  MP4 fallback and WebVTT captions, about 7 MiB, never autoplaying), so phones no
  longer wait for the canvas to draw. "Watch it drawn live" keeps the interactive
  film. `bun run film:render` records it, and the Pages deploy renders it.
- The pull request card recognises named reviewer seats such as `rev-opus` and
  `rev-astra` on a RESULT post's `Reviewer:` line, as well as numbered ones
  like `rev2`.
- An agent window's header no longer has a separate colour swatch: the agent's
  icon sits on its terminal colour, and clicking it opens the agent's settings,
  starting with the colour. This saves space in the bar.
- An agent window's header names the agent `<name>-<harness>` (for example
  `otter-claude`), shortened in the middle past 14 characters with the full
  name in its tooltip, and shows its state as a badge on the agent's icon (a
  tick when done, a spinner while working, **!** when it needs you, a grey dot
  when idle) instead of a word, which stays in the tooltip.
- Opening an agent works the same in Town, Board and Desk: it opens the agent's
  Chat when Chat can read its harness, and its terminal otherwise; a plain shell
  opens its terminal. **Menu → Agents open** (formerly **Town opens**) chooses
  Terminal instead for every view.
- Town's hover card no longer has an **Inspector** button: **Open chat** and
  **Open terminal** open the agent's window, whose Files and Changes views
  hold the rest.
- In Chat's composer, Enter starts a new line, as in the terminal composer;
  **Send** or `Ctrl+Enter` (`Cmd+Enter` on a Mac) sends.
- Local checks from parallel worktrees share one machine-wide queue: one World
  browser lane and one behavioral verification at a time, at most two static or
  unit lanes, with a "waiting for" message naming the holder. A pre-push that only
  merges `origin/main` runs static checks only (`bun run check:static`); CI stays
  the full gate.
- `HERDR_WORLD_TEST_GPU=1` renders WebGL in local World browser suites on the GPU
  (hardware ANGLE over Vulkan), cutting their CPU use, with an automatic fallback
  to SwiftShader. CI keeps SwiftShader.
- A `herdr notification show` with no sound is now a message for you rather
  than a finished task; with `--sound done` it is still a finish.
- Store Teams and Pods in one persistent Group model. Existing magnetic groups
  migrate automatically; Pod membership uses stable agent addresses, with explicit
  role transfers and bounded recent edit attribution.
- Local development uses less disk.
  - Behavioral verification's checker is downloaded once per user and shared by
    every worktree, and each worktree keeps only its newest verification runs.
  - Test runs, including a direct `bun test`, remove their temporary and test
    Chrome directories (and any Chrome still using them) however they end.
  - `bun run agent:worktree -- prune` removes merged, clean agent worktrees, or
    only their build output while an agent still works in them.
  - Heavy checks refuse to start below 3 GB of free space.
- Give every window one bar: identity, the view selector and **⋯**,
  maximize and close share a single row at every width. Minimize, snap and
  float move into **⋯**; the location line under the name opens branch and PR
  status, replacing the repository row and the PR card above Changes and
  Commits. In Town the window takes the Town prototype's dark look, in light
  and dark themes alike, with **‹ Back**,
  and on a phone it fills the screen like the terminal, with the views and the
  other agents and terminals under **⋯**. Pixelify Sans and JetBrains Mono now
  ship with World instead of falling back to system fonts.
- Town's docked agent window now opens 520px wide (at most half the screen)
  instead of taking half of a large screen, so Town stays in view and Chat
  lines stay readable. Drag its left edge to resize it; Town remembers the
  width. **Right half** in the window menu still takes half.
- Picking up a Town table or agent now feels physical: it lifts off, follows
  the pointer on a spring and leans into the motion, and a carried agent kicks
  its legs. Every confirmed move, in a room or to another room, lands with a
  bounce and a puff of dust; a refused move shakes and springs back. Calm and
  reduced motion keep the carry under the pointer and end with a short fade.
- Town rooms extend to fit: a room grows to its screen's width (eight tables
  on wide screens, six on portrait and half-width ones, four on phones) and
  then adds rows as more tables are revealed. Repeated expansion can show
  every observed tab without a fixed expanded ceiling. Desks keep their native
  tab order rather than promoting the newest or busiest agents.
- Town lays out buildings for its container: one column of rooms on phones,
  two on portrait and half-width screens, three on wide ones. A growing room
  moves only the rooms below it, waits while you hold, scroll or zoom the
  town, and keeps the room you are looking at in place. Zooming into a very
  large room, from its card or with Zoom in, opens at its first tables, and a
  table or agent held near the edge of the view scrolls the town toward rooms
  out of sight.
- Town's quest marker is now a swallowtail pennant beside a seated agent,
  in the quest's status colour and the same size at every zoom, so it no
  longer looks like a pin. Hover or tap it to see **Quest**, the title and
  its progress. A Loop or goal quest, which has no steps, used to show only
  a tiny gold square.
- Town room plates show active/total agents: working or waiting on you, out of
  all reported agents. Hover the count for the working/waiting breakdown;
  plain terminals and open asks do not add to this agent count.
- Keep folded Town desks in the same tab order as Spaces: show the first 24,
  with red needs-you and green unreviewed-completion icons on the bottom-right
  **» +N** tile for hidden desks. Selection, pins, activity and open questions
  do not promote later tabs across the fold boundary.
- Reveal up to 20 more desks per Expand click until the whole room is shown,
  with a separate Fold action available immediately after the first expansion.
- Open Town in Zen mode, full-bleed, with its own Zen choice. Zen now works on
  phones too, hiding the top bar and bottom navigation on Town, Board and Desk.
  While Zen is on, a view picker (beside Exit Zen on desktop, a corner button on
  phones) switches between Town, Board, Desk and Spaces.
- Board's **Work** lens now shows every pull request you opened that was
  merged in the last 7 days, not just the latest 20, grouped by the day it
  merged with today open; Done tickets group by the day they were resolved.
  Change the window, from 1 to 90 days, in **Settings → Sources**.
- Every World view now opens in Zen by default, not just Town: Board, Desk and
  Spaces show the floating view picker instead of the bars, on desktop and on
  phones. On a phone this includes Spaces' list, while an open terminal keeps
  its own bar with Back. One Zen choice covers all views, and **Zen mode** in
  the settings menu still turns it off.

### Fixed

- Close menus, dropdowns, pickers and the phone's workspace list top first.
  Tapping the terminal now closes a dropdown on phones; Escape closes a menu
  even while the terminal has focus; on-screen Back closes the workspace list
  opened from a terminal's title instead of leaving it over the scene; and
  focus returns to the terminal. One layer stack handles Escape, outside
  presses and Back for all of them: Escape and Back close the top layer,
  and a tap outside all of them closes them all.
- Chat no longer reports a message as sent to the conversation it shows when
  Herdr delivered it to another session. Herdr's prompt cannot be made
  conditional, so Chat shows a sent message as not yet seen until its own
  session's transcript has the same words after the send, and then marks it
  matched by its words, never delivered. A red notice names the other
  session, and pauses Send, only on evidence of a switch after the send, and
  Chat says when it can no longer check, or cannot tell. Slash commands use the
  same session-qualified prompt, with a **sent, not checked** receipt until the
  literal command appears in that session's transcript; this confirms text was
  seen, not that the command had its intended effect. Claude Code's `!` and `#`
  terminal input modes still require Terminal.

- History and Chat no longer show Codex repository instructions and environment
  blocks, Claude Code local-command caveats, task notifications, compaction
  summaries, subagent sidechains or rewound prompts as user messages. Remote
  Grok Build and Antigravity paths are no longer read from this machine.

- History shows Codex 0.157+ conversations again. With Thread ID added to the
  Codex title (`/title`), History reads which conversation a pane shows from its
  title, follows thread switches, and shows nothing rather than guess.

- Successful uploads from the desktop Message editor stay in its draft without
  reporting an input failure; uploads from desktop terminal output still use Direct.
- Notify once per available World release version and keep the menu attention dot
  and Upgrade action after dismissal, including a retry after failed upgrades.
- Preserve native Ctrl+Shift+V terminal text paste on plain-HTTP LAN addresses
  in Windows/Linux browsers, while keeping async image paste over HTTPS or
  localhost. Use Ctrl+V or drag and drop for images on plain HTTP. Custom paste
  shortcuts now explain the native paste, drag-and-drop and HTTPS alternatives
  when clipboard reads are unavailable.
- Keep terminal URL links usable in Town and Board Inspectors when adjacent
  progress rows repaint. Preserve a freshly verified OSC 8 target across repeated
  hover callbacks during desktop window activation, while changed targets and
  frames still require validation. Desktop modifier-click and phone Open link
  remain available with Composer open.
- Board Send asks again if a previously captured agent session disappears,
  even when the pane, terminal and foreground process group stay the same.
  Session loss during submission is reported as uncertain delivery instead
  of success; inspect the pane before sending again.
- An explicit Board **Send to** confirmation targets only the chosen agent,
  even if the original recipient returns before submission. Missing-session
  guidance distinguishes unavailable identity from a known replacement.
- Let native plugin compatibility checks wait for transient filesystem locks,
  while keeping persistent cleanup failures and original assertion errors visible.
- Notification 'Open agent' follows **Agents open**: Chat by default when
  supported, or Terminal when selected or when Chat is unavailable. Spaces opens
  the notified agent on its owning host and keeps the current Inspector if the
  notification is refused. Newer notification destinations stay selected when
  older lookups finish. Refused successors restore the original Inspector even
  when an older notification had already closed it, without replacing a newer
  user-selected Inspector.
- Chat and History can read Claude Code conversations on Unix SSH hosts when
  Herdr reports the session UUID. Lookup uses the selected host's transcript
  files, refuses ambiguous matches and never falls back to a local conversation.
  Readable, bound conversations support the existing session-checked Chat Send.
- Symlinked remote projects roots are resolved on their host. Discovered paths
  and stat results must retain the requested session and project-root binding.
- Files panel no longer crashes when an agent worktree file reference becomes
  stale. The affected preview offers recovery while Chat and the rest of the
  window stay open.
- Agents go by the name Herdr gives them (`firstmate`, `rev1`) instead of
  their harness (`claude`, `codex`) in Town (hover, nameplates, reception, call rail and
  pane labels), in window and Inspector titles, in Spaces agent rows, the
  command palette and the terminal's message prompt. Titles put the name
  first: `firstmate · claude`. Agents without a Herdr name keep showing their
  harness.
- Starting Claude or Codex from Board, or any new agent, no longer leaves a
  plain shell: World waits for the new tab's shell before starting the agent,
  gives the agent a name Herdr accepts, and reports at once when the harness
  exits or stops on a question (#219).
- Make Board's Work control a labelled leading pill, with phone-sized tap
  targets and single-row overflow. Keep Needs a home as a distinct note action,
  including an empty tray reachable from the menu when its count is zero.
- Restored Chat typing, Send and attachment uploads in the full app while
  keeping drafts isolated by host, runtime and conversation.
- Agent Files and Changes now share an evidenced worktree target rather than
  silently using the launch checkout. The location popover shows sources and
  alternate worktrees; stale or ambiguous evidence requires a current choice.
  Unreadable transcript evidence does not hide a usable live worktree, replaced
  bindings retire pending previews, and agent windows omit unrelated launch-tree
  Changes counts.
- Files and Changes refresh their worktree evidence when Herdr reports a changed
  foreground directory; the chooser clarifies that viewing a tree does not move
  the agent's terminal.
- Chat's overflow menu follows the shared Back/Escape layer stack so closing it
  preserves the underlying window and the unsent draft.
- Repeated scrolling while an earlier Chat page is loading keeps one request
  in flight, including when new messages move the recent-history window.
- A docked Chat window restored on page load, for an agent on a host the page
  had not opened yet, no longer stays blank until the agent is clicked, even
  when the connection comes up after the window mounts.
- Chat no longer runs off the right edge on phones: a long path, command,
  link or title wraps or scrolls inside its own bubble, and wide tables
  scroll instead of squeezing every cell to one letter a line.
- A message sent from Chat with an attachment is no longer left as "Sent; not
  yet seen" when Claude Code records the image as `[Image #N]`.
- A message sent from Chat over several lines no longer stays "Sent; not yet
  seen" or shows twice with its `pasted_content` tags: Chat reads Claude
  Code's paste wrapper and shows the words marked **Pasted**. When the harness
  rewrites a send, only a compatible later turn can match it by order; an
  unrelated prompt from another client leaves the send waiting.
- A sent message waiting for a busy agent sits at its send time as
  "Delivered · waiting for <agent>", never below replies written since.
- A loop the agent scheduled once (`ScheduleWakeup`) no longer shows as in
  progress after its wake-up has run and no further one was scheduled.
- An agent's window header shows the name given with `herdr agent rename`
  instead of the harness name, as Board and Desk do.
- Chat's message bubbles keep to about 75 characters a line in wide windows.
- Chat in an agent's window no longer runs past the window: the conversation
  scrolls inside it and the composer stays at the bottom, docked or floating,
  on phones and on large screens. Reopening, docking or undocking the window
  keeps the conversation instead of showing it empty.
- Chat stays responsive on long, busy transcripts. It now shows History's
  window (bubbles and collapsed tool cards that load their text when opened)
  and reads only what changed on each update, instead of rereading and
  redrawing the whole conversation.
- The Town master setting finds an agent by its Herdr name (`herdr agent
  rename`), not only by the label Town shows.
- Keep Codex Chat and History readable after Codex compresses older session
  rollouts, including SSH and archived sessions. Original transcript downloads
  preserve the compressed file.
- Read Codex conversations from a shared daemon when exactly one pane and one
  loaded thread match their directory and recent activity. Inferred conversations
  stay read-only; conflicting reports and ambiguous matches show no conversation.
- Keep desktop terminal arrow keys and Ctrl combinations working when the
  phone-only Message composer remains open in the background. Preserve drafts
  and the phone's explicit Direct input control.

- Keep the phone's Direct terminal button visible while editing an expanded
  Message draft, and distinguish `/ Commands` from Direct terminal typing.

- Restore side-by-side Composer / Direct mode controls for terminal input,
  keeping command suggestions separate and preserving the draft in Direct mode.

- Use adjacent keyboard / terminal icons for Composer / Direct and keep special
  keys visible in both modes, with the draft field shown only in Composer.

- Put mobile Inspector view switching in its header dropdown and move Watching,
  Muted and Focused to the window's ellipsis menu.

- Put the desk pin first in mobile window menus and keep it in the desktop
  window menu. Order primary Inspector views Chat, Terminal, Files, Changes.
- Keep failed or unsupported harness readiness checks unknown instead of
  reporting the harness missing or logged out. Show safe check details and
  retry guidance while keeping supported harnesses available.
- Keep Inspectors, terminal output, split layouts and unsent Message drafts through
  mobile backgrounding and browser network interruptions. Reconnect to the same
  runtime without replaying input; terminal recovery now offers local retry and
  explicit app reload instead of automatically reloading the page.

- Keep cached Files and Changes content while the same worktree is being
  readmitted after reconnect, and preserve other Inspectors' Message drafts
  until a fresh catalogue confirms their runtime was replaced or removed.
  Keep the stale Inspector notice above the phone Message editor so retained
  drafts remain visible.
- Retire cached PR-detail readiness and open merge sheets at the original expiry
  deadline, including idle cards that have not received another source poll.

- Label cached pull request detail with its own freshness and read time after
  failed or expired reads, retain useful evidence links, and require fresh
  head-qualified detail before World dispatches a merge.
- Keep formal review and comment RESULT evidence visible on pull request cards,
  including source links for unknown reviewers, and reject ambiguous reviewer or
  commit claims and contradictory finding counts when computing readiness.
  Historical evidence SHAs no longer contradict the declared reviewed head.
- Keep Spaces responsive when a host repeatedly returns a stale tab layout,
  while retrying for the selected pane on its original host.
- Mark failed-host Town buildings, receptions, agents and Board cards stale,
  keep live actions disabled, and offer an explicit Reconnect control.
- Continue automatic recovery from transient SSH tunnel failures with capped
  backoff, including initial remote HOME discovery, instead of leaving a
  reachable host permanently failed after six tries.
- Show Town building signs when their DOM first mounts or returns after camera
  culling, including the failed-host Reconnect control at roof level.
- Keep Board card resize observers attached during status refreshes to avoid
  redundant layout and drawing work while typing in a terminal.
- Phones show the Town board again: a compact chip under the search bar
  counts agents working, needing you and done, and opens the full board with
  spend.
- Apply Town Fold and Expand immediately after a tap instead of waiting for the background layout quiet period.
- Town room nameplates stay within their rooms, truncate only long names, and
  reveal Rename and Close below on hover, focus or touch. The dashed **+** seat
  opens that room's agent launcher, with Terminal first for a plain shell tab.
  A removed room or replaced host runtime requires a fresh room choice instead
  of silently sending creation to another host.
- Town Summary room and host counts follow the observed agent roster when raw
  coverage includes additional agents.
- Keep Town responsive during dense status refreshes by reusing prepared room
  totals and qualified attention lookups for Summary and desk admission.
- Windows: installing or upgrading the Herdr plugin no longer reports a failure
  when the installer cannot yet delete its temporary copy of the new binary
  (for example while an antivirus scan holds it). The folder is removed by a
  later install; a real install failure is still reported as one.
- Let `agent:worktree -- prune` remove eligible worktrees when unrelated processes
  use the filesystem root, ancestor directories or similarly prefixed sibling
  paths, while retaining worktrees referenced by Docker mounts or shell commands
  and when process inspection is unavailable.

## [0.2.6] - 2026-10-21

### Documentation

- Refresh the shared Files, Changes and History screenshots with Board behind
  the Inspector, and update their captions and capture provenance.

- Focus the README, tutorial, feature guide and website on Town, Board, Desk and
  Spaces, with current Town/Board layouts and desktop/mobile captures. Identify
  Office, Tree and Graph as retired views with redirects to Town and Board. Show
  a readable mobile Board close-up and describe Send's recipient identity checks.

### Added

- Add Board, a pin board view. Hosts are zones,
  workspaces are cards and tabs sit around their workspace. Cards are springy
  while you move them and settle within about a second; a workspace carries its
  tabs, folds into a stack and opens into free space; Tidy works on a workspace
  or the whole board and can be undone. Zooming out shows each workspace's tabs
  as status squares (hollow for plain terminals). A tab with several panes lists
  them as rows you can select or open on their own, and a tab of plain shells
  looks like a small terminal. Tabs pulse in their most urgent agent's status
  colour, which the view's ⋯ menu can turn off. Double-tap the board for a
  sticky note and drag a card's red dot to string a note to a workspace, tab or
  exact pane; click a string to cut it. Notes, strings and the board's layout
  are saved by the World service and appear on every device. A note strung to an
  agent's pane can be sent once to that agent after World checks the runtime,
  witnessed pane/terminal IDs and that the same agent is still there. After Herdr
  restarts, Board asks
  before trusting strings whose terminals changed; strings whose target closed
  wait in a Needs a home tray instead of attaching to the wrong card. A note
  offers Start an agent in a chosen workspace; choosing Claude or Codex currently
  opens a shell rather than launching the selected agent
  ([issue #219](https://github.com/IvoryHeart/herdr-world/issues/219)). Drag a tab
  onto another workspace to move it there (Board asks first, with "Don't ask
  again"); strings follow the moved panes. On phones Board is in the bottom
  navigation.

### Changed

- Town and Board read touch and mouse input through one shared gesture
  machine. On phones, Board now asks you to hold a card still before dragging
  it, as Town does for tables and agents, so a quick swipe across a card pans.
  A second finger always turns a drag into a pinch without dropping it. Board's
  frames pause their settling while you type in a terminal.

- Board's event trace, and the renderer counters behind `?officeDebug=1`, are
  now development-only tools: release builds contain none of them. Development
  builds keep Board's trace, add one for Town (settings menu, `?debug=town`), and
  replace `?officeDebug=1` with `?debug=town`.

### Removed

- Retire the Office, Tree and Graph views. Town and Board replace them: old
  `/office` addresses and saved Office views open Town, and `/graph` and `/tree`
  open Board, replacing the history entry. The Inspector opening preference and
  Town's calm motion keep their saved values; Office's room alignment and
  long-title settings are gone. The optional Prometheus cost metrics now appear
  on the Town board. The web build drops about 1.6 MiB.

### Fixed

- Board's New tab dialog, and its other dialogs, now open above open terminal
  windows instead of behind them.
- A terminal created while another terminal is selected now opens. A snapshot
  taken while Herdr was still creating the tab no longer cancels the opening with
  "Tab created, but Inspector focus failed". This was most noticeable on phones.
- Board stays responsive on a large World: at 64 hosts and about 1,500 tabs,
  typed input had waited up to 20 seconds behind Board's rendering.
- On a phone, long-pressing a link in a terminal offers **Open link** again
  while an agent keeps repainting (its spinner withdrew it before it appeared),
  and in Town, whose terminals open with the Composer up and refused selection.
- Board's Send goes only to the agent the note was strung to. If another agent
  now holds the pane, even in the same terminal, nothing is sent: Board names it
  and sends to it only when you choose to. A change during sending is reported
  as possibly delivered elsewhere, never as sent.
- Board keeps a tab and a workspace apart when they share a native ID, opens a
  card from the keyboard or assistive technology, shows search results, and
  marks the selected card for assistive technology.
- When a Town move finishes, the dragged table or agent fades or springs home
  from where it was waiting on the target, instead of jumping back to where it
  was dropped first.

## [0.2.5] - 2026-10-18

### Added

- Add Town, a new view next to Office. Each host is a building along a road,
  each workspace a room on a carpet and each tab a team table with one seat per
  pane (a solo desk for one pane, a small face-to-face table for two), with up
  to 19 desks per room. Plain terminals show a green prompt instead of an
  agent's laptop. A desk with more panes than seats shows how many more and
  lists every pane on tap. Agents that need you walk to their host's
  reception and queue oldest first. Finished agents join them with their work
  left on the desk until you open their terminal or mark it reviewed, then take
  a break in the lounge with idle agents. Speech bubbles show questions,
  finished work and typing, and desks and seats carry their tab, agent and
  terminal names.
- Town lists agents that need you in a needs-you rail (a bottom tray on phones).
  Hover or tap an agent for a peek with its recent messages (from its session
  history, or its screen when it has none), its question in a
  highlighted box, one-tap answers and a reply line with 📎 attachments. On phones the reply line
  opens World's composer (keys, attachments, Insert and Send) right in the
  peek; Inspector opens the agent's files, changes and history. Answers and finished agents show short notices.
- Town's + and − buttons, centred on the right edge (with the More menu on
  phones), step between the whole town, one building, one room and
  one desk. Tap a room to zoom in; very large towns open at roof level. Phones stack the
  buildings in one column. A Town calm motion setting reduces ambient motion.
- Move Town desks and agents: drag a desk onto another room of the same host,
  or an agent onto another desk (hold, then drag on phones; press M on a
  focused desk or agent from the keyboard). The live panes move, so agents keep
  running; a failed move is rolled back, and moving a room's last desk asks
  first because the room closes.

### Changed

- Refresh the tutorial and feature guide for Town, Office, Desk and Graph,
  including Town replies and mobile navigation. Require relevant documentation
  updates alongside significant changes. Add desktop/mobile Town source-preview
  screenshots to Pages and show the latest stable release with an updating badge.
- Town is now the default World view: the World root, unknown routes and
  invalid view values open Town. Office stays one tap away at `/office`.
- On phones, the on-screen Back in a terminal returns to the view at once,
  even with the Composer open; the phone's own Back still closes the Composer
  first.

### Fixed

- Town closes up a room when a desk closes, instead of leaving an empty gap.
- Remove the upstream demo from the public website, clarify Town copy, and keep
  release details together. Stop featuring Tree in the website showcase.
  Version built CSS and JavaScript URLs to prevent
  older cached assets from breaking a newly deployed page.
- The phone's Back closes open layers one at a time (Composer, then the
  terminal) instead of leaving the page on the second press in Chrome, which
  skips history entries a page adds without a tap.

## [0.2.4] - 2026-10-16

### Fixed

- Retry transient Windows installer-test cleanup locks within a bounded window,
  while keeping persistent cleanup failures visible to the required gate.

- Keep terminal IME positioning correct when the terminal cursor is hidden.

- Quote compile-time environment filters so native Windows source and release
  builds pass literal patterns to Bun instead of failing shell glob expansion.

- Honor native TLS and managed credentials in plugin URLs and panels, and verify
  Windows plugin downloads without relying on PowerShell hash cmdlet discovery.

- Diagnose the saved default Herdr connection, preserve package/plugin and preview
  update ownership, and refresh generated service paths when restarting the plugin.

- Bind upstream approval to the reviewed World base, reject obsolete source
  baselines, preserve integration evidence in PR descriptions, and keep failure
  blockers effective when unrelated issues share their title.

- Show the resolved build version in the application menu instead of the
  development manifest placeholder.

- Keep a visible Back action in the mobile app bar while a visual Inspector is
  open. Return to Office, Desk, Tree or Graph without terminating terminal
  sessions or expanding the ellipsis controls. Hide the logo and product name
  from the mobile app bar to give its navigation controls more space. Keep the
  view switcher at the left beside Back, including while an Inspector is open.

- Mobile terminals in Office, Desk, Tree and Graph open the shared Spaces
  Composer/Direct input panel. Inspector title and resource bars collapse while
  viewing a mobile terminal; existing mobile navigation keeps resource and window
  controls available. The keyboard launcher opens the visible terminal directly;
  concurrent Inspector drafts and attachments survive input-panel reopening and
  focused-host changes without admitting retired runtime work.

- Keep retained unavailable Ranger workspace permissions visible and individually
  revocable without clearing unrelated grants.
- Reject Ranger history and Git diff reads on Windows SSH runtimes before calling
  Unix-only helpers, while preserving native status and terminal reads.

- Preserve terminal shortcut key identity and modifiers, and prevent duplicate
  input composition finalization.
- Surface specific Ranger task errors and retain runtime generations when editing
  tasks with saved mentions.

### Added

- Synchronize Roamgate v0.8.5: searchable desktop shortcut cheat sheet and readable
  workspace/worktree suggestions, retaining World’s qualified creation flow.
- Accept login passwords from 8 to 1024 Unicode characters; warn below the
  recommended 15 characters for access beyond a trusted private network.

- Require native installer checks before merge: build release-shaped candidates,
  test fresh installs and upgrades from the latest stable release on six platforms,
  and verify credentials, settings, cached plugin actions and failed-download recovery.

- Install released Herdr World plugins on Unix and Windows without external Bun,
  preserving cached plugin actions, verified World releases and service ownership.

- Synchronize Roamgate v0.8.4 source: installation-management commands, worktree
  pull-request badges, safer File Explorer mutations, mobile terminal shortcuts,
  and Ranger provider fixes. Preserve World packaging and qualified runtime ownership.

- Upstream synchronization records every incoming commit and revisits deferred work;
  new deferrals and intentional divergences require human approval.

- Opt-in hourly Roamgate source synchronization with Codex integration,
  independent agent review, one bounded repair pass and protected auto-merge.
  Agent sessions run locally using Codex subscription sign-in, without an API key.
  Changes to delivery and verification controls retain human approval.

- Maintained Quint development tooling, implementation-connected lifecycle,
  observation, protocol, creation and Ranger models, a reconciled 43-area evidence
  inventory and candidate CI/contributor guidance. Independently accepted bounded evidence is required by local and protected CI delivery gates.
  Startup currency fences now have independent fault controls, and failed
  verification runs retain bounded diagnostic artifacts for reproduction. Checker
  startup waits for protocol readiness before invoking Quint. Canonical verification
  runs independent cases in a bounded parallel pool with complete aggregate evidence.
  Models/adapters live in top-level `quint/`; Linux CI enforces and measures an
  aggregate memory/CPU envelope while retaining existing consumer/platform tests.
  Cancellation is rejected after resource accounting and final cleanup, with
  required deterministic real-cgroup regressions for both post-exit boundaries.
  Canonical/focused publication and private-checker teardown also reject late
  cancellation, retaining incomplete evidence and failure diagnostics.
- SSH profiles can connect to Windows Herdr 0.9.1+ sessions through Windows
  PowerShell, with optional executable and session selection. Unix-only remote
  file, Git and history tools explain their limitations.
- Ranger can propose task updates, pause/resume, cancellation/deletion, and closing
  agents, panes or workspaces using captured identities and confirmation policy.

- Ranger workspace and agent mentions, quick model and thinking controls, custom
  thinking effort, and explicit all-workspace consent for High permission mode.
- Optional `HERDR_WORLD_PIN` login for private networks, with separate failure
  limits and password/token recovery. Session cookies use independent private
  signing state and expire when configured credentials change.
- Ranger can offer Open worktree for existing workspaces not opened as worktrees.

### Changed

- Follow phone platform conventions on mobile. Office, Graph, Desk and Spaces
  switch from a bottom navigation bar, replacing the view switcher. Terminal
  screens show Back, the terminal's name as a workspace switcher, Tabs and a ⋮
  menu that holds the former floating controls. A Message bar below the output
  raises the keyboard in Composer with one tap, beside a Direct button. Tabs
  lists the visible terminal's workspace, and choosing one opens its terminal.
  The phone's Back gesture closes the topmost menu, sheet, Composer or
  terminal, one per press, before leaving the scene.

- Remove the mobile Office targets row and visible title-bar summary counts to
  give the Office scene more room. Canvas controls and search remain available.
- Ranger settings and chat history use clearer sections; compact conversations
  put the minimap below the messages.

- Synchronize Roamgate through `d1a22cb4` (v0.8.2), preserving World
  connection ownership, React 18, browser regressions and distribution tooling.
- Pin Bun 1.4.3 and its types, and include Bun's native type checker in validation.

- Organize the World shell, Inspector coordination, Office drawing and visual-view
  styles into focused modules while preserving connection ownership, presentation
  and the existing responsive CSS cascade.

### Known issues

- Intermittent input-latency budget failures in dense synthetic browser tests
  remain under investigation for the next release; keep existing budgets unchanged.
  See [issue #202](https://github.com/IvoryHeart/herdr-world/issues/202).

## [0.2.3] - 2026-10-08

### Added

- Ranger workspace chat, proposed actions, background and scheduled tasks, and
  monitoring alerts, scoped to permitted local and SSH workspaces.
- Git commit history, file-preview tabs, tab pinning and reordering, pane movement,
  terminal font and input controls, file uploads, and instance title settings.

### Fixed

- Verify the selected GitHub credential on older CLIs even when another saved
  account has an expired token.
- Use a framed view icon for World view selection, distinct from Ranger settings
  and window arrangement.
- Restore the floating mobile workspace navigator and hide it on desktop.
  Office redraws after returning from Ranger or another hidden workspace surface.
- Integrations and repository settings stop loading when their selected host is
  unavailable, and repository refreshes wait for pending requests to settle.
- Recognize authenticated older GitHub CLIs that do not support `--active`.
  Keep repository status and source controls in an Inspector header popover.
- Confirmed Ranger task actions recheck workspace permission and cancellation at
  dispatch, preventing writes after permission revocation, task stop or disposal.
- World browser tests give cold Chrome startup a separate bounded allowance,
  preserving fixture deadlines and responsiveness assertions.
- The compact Inspector browser test waits for its Files back action and explorer
  layout before checking visibility.

### Changed

- Synchronize Roamgate through `d703e6f6` (6 October 2026), retaining World's visual
  views, connection ownership, service packaging and browser responsiveness.
- Require login on every listener, including localhost. Configured passwords must
  contain 15–1024 characters; otherwise World creates a persistent login token.
  Login attempts are throttled.

- Test files run in bounded parallel workers. Isolated browser acceptance cases also run concurrently, with lower concurrency in CI.
- World browser acceptance suites reuse immutable bundles and run across eight isolated CI shards, preserving scenario coverage and responsiveness budgets. CI artifacts retain input timings for responsiveness investigations.
- Release validation uses the same isolated World browser shards as PR CI and waits
  for every shard before packaging. Release and Prepare Release cap test files to
  one worker to prevent browser contention.
- Opt-in browser lifecycle comparisons retain baseline and candidate evidence for
  CI timeout investigations.

## [0.2.2] - 2026-10-05

### Fixed

- Office is the default view. New seat and New room prepare the correct browser-owned
  source terminal, including cold workspaces, inactive hosts and mobile. Office,
  Desk, Tree and Graph share New workspace and New tab actions and open created
  terminals without switching views. Rooms retain eight displayed desks while
  allowing additional tabs. Spaces reuses the same terminal owners and creation path.
  Pending creation retains its source through pane selection and zoom changes,
  and completion follows the current Spaces or visual view.

### Changed

- Inspectors and arranged Spaces windows now share stable snapping, all-edge resizing,
  minimize/window switching, maximize/restore and tile dividers. Opening or focusing
  another window preserves existing placements. Tree uses the same window surface,
  and the Office Docked preference becomes Snap right. Closing a Spaces window
  dismisses its presentation while leaving the Herdr tab running. Desktop window
  switching and arrangement controls are always reachable from the top bar.
  Resizing a scrolled tile preserves its canvas position, and Open all restores
  dismissed or minimized windows even when Grid cannot fit the work area.
  Snap and maximize previews match the visible work area in scrolled layouts,
  while dragging and resizing retain the full canvas bounds.
- Mobile keeps the ellipsis menu floating, uses the second-row Tabs menu for tab
  actions and window restoration with Arrange beside it, removes the duplicate list
  icon and tab strip, and measures World shell height once for terminal and keyboard sizing. Desktop
  placements survive compact views. Roamgate terminal and pane ownership remain intact.
  Selecting a tab opens its terminal Inspector in every visual view, including
  before any Inspector is selected and when its panes need loading.

- Default update checks read the release version from GitHub API metadata. The
  manifest remains part of the verified update installation.

## [0.2.1] - 2026-10-04

### Breaking Changes

- Hosts now filters an aggregate Desk, Office, Tree and Graph view instead of selecting
  one operational host. Manage connections remains separate. Open Inspectors,
  terminals and resources retain their qualified host across filter and focus
  changes; global creation confirms a single destination.

### Added

- Added the Desk, now the default view, with triage across filtered hosts and
  connection-qualified receipt and screen reads. It sorts agents into Needs you, To review,
  and In flight. Each card shows the agent's question, report, or live terminal
  line, and the turn's request, duration, and edited files. The cards support
  keyboard triage. Agents and Reviewed modes, one search across them, and Undo
  after marking keep every agent and reviewed stop one step away. On wide
  screens, agents open in a docked reading pane beside a one-column queue.

- Concurrent local/SSH terminal and Inspector contexts over one World origin,
  host-local retirement, qualified notification reveal, fair bounded multi-host
  projection and observation, full-observation paged search, honest coverage and
  cross-host window arrangements with independent restore baselines.

- Added "Promoted to CEO", a 62-second animated film about Herdr World, to the website.
  It plays in the browser with a synthesized soundtrack and no video download.

- Added `agent:await` for foreground agent commands with bounded output, private
  logs and preserved exit codes, plus repo-local Herdr Workflows operating guidance.

### Changed

- Office reuses unchanged rooms and cached static artwork, prepares graphics in
  bounded tasks, and retains semantic controls and keyboard focus across topology
  refreshes. State paints continue during uninterrupted terminal typing.
  PixiJS 8.22 keeps animation, selection and scrolling responsive while preserving
  the established scene. Decorative motion yields briefly to terminal typing;
  hidden, idle and reduced-motion scenes stop autonomous paints. Shared furniture
  geometry and stable selection projections further reduce refresh work. Graph
  physics runs in a worker with spatial queries, cached drawing and a shared
  visibility/input-aware frame scheduler. Office and Graph input regression budgets are
  tightened to p95 below 150 ms and worst case below 450 ms.

- Worktree resource requests expire after twenty-five seconds and are cancelled when their
  owner is discarded. Retrying Files or Changes preserves the already-open checkout
  without repeating its opened hook. Qualified workspace reads discard remembered
  targets that have closed, so the checkout can reopen on the next attempt. Workspace
  list failures report the failed read without implying a checkout reopen was attempted.
- Upgrading to the aggregate multi-host Desk resets existing browser-local Desk
  review marks once because their storage scope and receipt identities change.

- Worktree Files and Changes open the owning visual Inspector without switching
  unrelated Spaces focus. Temporary-workspace removal retains cleanup failures.

- Status-only agent updates retain confirmed session identity for notification
  targets; reported session replacements wait for confirmation. Removed host
  priority hints no longer block healthy snapshots, and overlapping clients
  preserve queued host priority.
- Qualified workspace commands retain visible failure feedback and Git pull
  progress/output. Git mutation uncertainty remains visible with its original
  host after retirement, without replay or replacement-context refresh.

- Desk receipt and screen queues run independently by host and share bounded
  read capacity across equally urgent hosts, so slow hosts leave healthy agents
  available for review and live observation.

- Inspector tab shortcuts restore the destination tab's selected pane and refresh
  unobserved panes. File preview and Changes cache invalidation follows runtime
  generations even when browser transport epochs differ. Mutations whose response
  is withheld after runtime retirement retain an uncertain-outcome notice naming
  the owning host even if the browser has already observed retirement; retirement
  after successful response decoding remains a stale-context error.

- Mobile top-bar controls use icons for Hosts, view selection, Actions and Menu,
  with a distinct compass for view selection, a host-count badge that counts
  matching runtime endpoints once, and
  aggregate status text hidden.

- Spaces sidebar selections activate the terminal's owning host. Workspaces with
  shell terminals can expand in the host navigator even when no agent is running.
- Host groups and terminal rows keep their established order when selection,
  focus or agent status changes.
- Office keeps admitted workspace rooms, desks, pane devices and standing agents
  in a stable order when terminals are selected. Graph retains readable node
  labels when Fit zooms out.
- Hosts adds collapsible groups around the existing workspace navigator, retaining
  its agent layouts, worktrees and context menus. The host filter opens above the
  toolbar with connection management. Workspace/room selections open Files;
  agent, pane and tab selections open terminals on their owning host even before
  its first operational refresh finishes.
- Terminal input with a lost acknowledgement reports its original host and an
  uncertain outcome, with refresh-before-retry guidance and no replay.
- Large aggregate updates share the World socket in bounded reply chunks, and
  dense scene controls render progressively to keep host input responsive.
- Saved Hosts filters survive the initial connection handshake until a valid
  catalogue arrives. Large snapshots decode off the browser's main thread;
  unchanged terminal surfaces and offscreen scenes avoid redundant drawing.
- Dense aggregate indexing yields between bounded batches and preserves complete
  coverage totals. Office limits reception painting to the visible horizontal
  region while retaining every host in its semantic overview. Streaming output
  preserves another terminal's keyboard focus.
- Dense host construction also yields and cancels within a host. Office reuses
  qualified pane devices across its scene and complete roster, and newer
  Inspector control focus supersedes queued terminal refocusing.
  Expired aggregate observations yield between hosts to admit terminal input.
  Snapshot decoding admits one host payload at a time so socket acknowledgements
  can interleave with observation work.
  Negotiated snapshot transport waits for browser admission after each bounded
  chunk batch, preventing bulk replies from queuing ahead of terminal input.
  Progressive Tree admission reuses unchanged spaces instead of rendering
  every admitted subtree again on each batch.
- Graph overview keeps every node and semantic target while deferring unreadably
  small canvas text until zoomed in.
- Office constructs and paints its visible scene across cancellable task turns,
  admitting matching layout controls through ordinary tasks after painting.
  Its canvas and text textures follow the visible viewport and device resolution
  while retaining the complete layout and two-axis navigation.
- Removed the homepage film introduction so the video leads directly from the
  navigation into the product content.
- Removed CEO Mode from the homepage navigation and added a full-screen film
  control. The film now shows the full website URL and a one-shot npm command.
- Styled the homepage, film, and social preview cards as Herdr.World.
- Put the "Promoted to CEO" film first on the homepage, with a Home navigation
  link. Its play overlay and controls now clear during playback.
- Turned the product hero screenshot into a carousel of the six showcase views.
- Moved installation closer to the top of the homepage and showed Homebrew,
  npm, and standalone commands together.
- Refreshed the website and README screenshots with the 0.2.0 interface, including
  readable Files, Changes, and agent History examples.

### Fixed

- Kept Inspector terminals in sync with keyboard tab navigation and creation,
  and revealed qualified notification targets omitted from the host overview.
- Preserved refresh support on the declared browser baseline. Interrupted file
  mutation responses now report uncertain outcomes and refresh the owning
  directory; healthy iOS downloads retain their fallback when native sharing fails.

- Preserved server error details for rejected resource requests and showed failed
  file and session downloads without reopening them on another path.
- Kept worktree results focused through metadata refreshes while respecting newer
  browser selections, and prevented duplicate workspace creation submissions.
- Reported observed watch counts when another filtered host is unavailable.
- Prevented Office animation from starving large aggregate refreshes while
  another host remains interactive. Removed redundant transport and decoder
  timer turns while preserving bounded batches and one-host admission.
- Kept the film's 16:9 picture from stretching in portrait fullscreen playback.

## [0.2.0] - 2026-10-02

### Highlights since 0.1.1

- Explore agent work in Office, Tree, Graph, and Spaces, with terminal, files,
  changes, and history available from the selected agent in every view.
- Keep multiple Inspectors open and arrange, move, resize, or dock them while
  preserving each live conversation. Graph can arrange or rotate its layout.
- Connect to local and OpenSSH Herdr hosts through one World service. Select the
  host you want to work on while other connected hosts remain visible in the
  background.
- Follow agent progress with task summaries, checkout context, pane pins,
  notifications, and optional Office metrics. Visual Actions take you to the
  selected agent's details or workspace.
- Install the same release through six desktop archives, the standalone
  installer, npm, Homebrew, or the Herdr plugin. The responsive PWA provides a
  mobile view when World is reachable.

### Breaking Changes

- Replaced the 0.1.1 app with a new World service and responsive Web/PWA.
  Recreate connection profiles after upgrading; old bridge profiles and browser
  preferences are not imported. The native Android package is retired.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Task summaries now follow the current pane session and expire automatically.
  Hooks using `herdr-world task-summary --clear` must be updated; the command
  no longer accepts `--clear`.
  [Herdr World PR #105](https://github.com/IvoryHeart/herdr-world/pull/105)

### Added

- Prepared the project website and tutorial for `herdr.world`, including search,
  social preview and Homebrew homepage metadata.

- Added Tutorial, Features and shortcuts, Troubleshooting, and Report an issue
  links to the application menu. Restored native HTTPS, Web Push, compatibility,
  logging, and Pane Search guidance; corrected inherited documentation links
  and website attribution. Stable release publication now requests a Pages
  deployment while retaining the live installer guard.

- Restored the npm and Homebrew installation channels for the new foundation.
  npm now installs one platform binary through optional dependencies; Homebrew
  installs the same checksum-pinned release archive. Both serve the one World
  service and require Herdr as a separate runtime. Release candidates use all six
  platform archives, npm's `next` tag and a separate Homebrew RC Formula.
- Added a clickable pane-count laptop on each Office desk and up to three surrounding monitors so
  split-pane agents keep exact terminal targets after leaving their work room. Done agents now join
  input-needed agents at their host's reception with distinct `✔` and `?` cues; extra agents stand
  nearby before entering the roster. Up to four additional working agents can gather around the
  same desk without covering each other's faces or its pane screens. The compact Office chooser
  pages longer rosters so every admitted pane remains reachable.
- Added accessible maximize and resize controls across Office Inspector windows,
  focus-based window stacking, and Close all terminal windows in Arrange and
  Actions. Close all preserves Herdr tabs and sessions; Spaces keeps each
  workspace suspended until explicit tab selection or arrangement. Graph can
  rotate left or right in quarter turns while keeping labels upright. Floating
  Inspectors no longer stop at five. Grid and Rows scroll vertically, while
  Columns scroll horizontally, keeping large window sets usable with nearby
  terminal views mounted. Cascade repeats its overlapping pattern in scrollable
  stages when another offset would make windows too small. Open all terminal
  windows in Arrange and Actions presents every available terminal tab on the
  selected host. Arranged Inspectors have prominent scroll controls at fixed
  stage edges, and switching layouts keeps windows visible; scrolled windows
  stay clipped inside the stage.
  [Herdr World PR #123](https://github.com/IvoryHeart/herdr-world/pull/123)
- Added an Arrange graph control beside Fit in Graph view. Arrange spreads visible
  nodes into a readable hierarchy, wraps multiple hosts, and recenters the camera
  after manual pan while preserving zoom when possible. Arranged positions stay
  fixed through graph revisits and topology updates, and nodes remain draggable.
  Fit remains a separate viewport action; both controls are visible whenever the
  Graph canvas is shown at narrower desktop widths.
  [Herdr World PR #116](https://github.com/IvoryHeart/herdr-world/pull/116)
- Added shared tab-bar arrangements for existing Spaces tabs and open visual
  Inspectors: Single, Cascade, Columns, Rows, Grid, and Restore positions. Split
  panes remain inside one tab window, docked and Tree inline Inspectors can join
  an arrangement, Cascade uses the default floating-window size, and Columns and
  Rows shrink evenly for additional windows while keeping controls usable. Layouts
  that cannot fit explain their size limits. The desktop layout button sits at
  the tab bar's right edge and mobile places it in the ellipsis-expanded controls.
  The same placements are available through the original shell Actions command
  menu in every view; keyboard shortcuts can be assigned in preferences and
  are unassigned by default. Compact visual views keep desktop placements
  across arrangement and resize input for return to desktop, and tiled Inspector
  headers keep their controls reachable.
  [Herdr World PR #111](https://github.com/IvoryHeart/herdr-world/pull/111)
- Added connection- and generation-qualified Actions to Office, Tree and Graph.
  Actions capture the visible selected entity, reopen its existing Inspector
  resources or focus it before entering Spaces, and reject retired selections
  without using hidden Spaces focus. They provide no terminal injection, task
  assignment or agent lifecycle controls.
  [Herdr World PR #108](https://github.com/IvoryHeart/herdr-world/pull/108)
- Added `herdr-world agent-checkout` and a read-only Agent checkout Inspector
  scope. Harnesses report a bounded, session-fingerprinted checkout once; World
  reads its branch and changed files on the same qualified connection, offers an
  explicit Workspace changes scope, and labels unverified links as Reported PR.
  Reports have no TTL, renewal hook, Clear command, or agent-path Git mutations.
  [Herdr World PR #107](https://github.com/IvoryHeart/herdr-world/pull/107)
- Added a bounded service-memory watchlist for exact qualified agent and terminal
  panes. Office, Tree and Graph share Pin/Unpin updates across browser windows;
  watched topology is reserved within World observation bounds and unavailable
  records never enable operational actions.
  [Herdr World PR #106](https://github.com/IvoryHeart/herdr-world/pull/106)
- Added short, expiring task summaries for the active agent session. A harness
  can publish a summary without starting the World service, and World hides it
  when the session changes.
  [Herdr World PR #105](https://github.com/IvoryHeart/herdr-world/pull/105)
- Added Herdr semantic task notifications, plugin popup panes, terminal font
  sizing independent of interface scale, and File Explorer path drag into terminals
  from the Roamgate source merge.
  [Herdr World PR #103](https://github.com/IvoryHeart/herdr-world/pull/103)
- Added in-app setup for local and OpenSSH Herdr connections, with clear retry
  and failure states in one World application.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added a view of several connected Herdr hosts while keeping actions scoped to
  the selected host and unavailable hosts read-only.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added Office, Tree, Graph, and Spaces with shared navigation to terminals,
  Files, Changes, and Agent History.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added optional Office Economy metrics with in-app configuration and a clear
  provider status; core views and terminals work without them.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Added standalone archives, an installer, service management, and a Herdr
  plugin for Linux, macOS, and Windows.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Changed

- Improved file links in Windows terminals and recognition of wrapped links with
  Herdr 0.9.1 through the Roamgate v0.7.11 update.
- Kept the selected host responsive when another host is slow or unavailable.
  Delayed results can refresh its view later, while stale information cannot
  enable actions.
  [PR #104](https://github.com/IvoryHeart/herdr-world/pull/104)
- Updated file diffs, worktree navigation, and notification behavior from
  Roamgate v0.7.10 while retaining World's separate Herdr connections.
  [Herdr World PR #103](https://github.com/IvoryHeart/herdr-world/pull/103)
- Updated sign-in, session handling, terminal transport, notifications, file
  previews, and diff navigation from Roamgate v0.7.9.
  [Herdr World PR #97](https://github.com/IvoryHeart/herdr-world/pull/97)
- Rebuilt the application on the Roamgate foundation while keeping Herdr as the
  separately installed runtime.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Restored the retained Pixi Office as the primary World surface and placed the
  machine selector, Office/Spaces/Tree/Graph selector, selected-host/runtime
  summary, Actions and Menu in that order in the existing application top bar,
  removed the separate Visual Control Plane header, and retained the Spaces
  workspace navigator, focused tabs and annotations as the common frame around
  every view instead of duplicating Graph navigation. The shared workspace
  navigator can now be hidden and restored from its stage-edge controls; Zen
  mode removes it from the stage layout and reveals it as an overlay from a thin
  left-edge target, parallel to the top bar.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Unified selected-agent identity with the shared Inspector in Office, Tree,
  Graph and Spaces; placed Terminal first and made it the default for each new
  terminal-capable selection, with one docked and up to five independently
  movable/resizable full Inspectors that retain their own tabs and resources.
  Office now defaults new installations to separate cascaded floating Inspectors,
  persists a user's docked or floating choice in the common Menu, and keeps room
  alignment, long-title and observability settings there instead of reserving
  Office or Zen scene space. Tree now expands the exact selected leaf as its inline
  Inspector and transfers the complete conversation through Dock out and Dock in.
  Explicit docking actions remain available without rearranging existing
  conversations.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Made the release version consistent in the application, archives, plugin,
  and update information so an installed build is easy to identify.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Kept qualified multi-host observation in the service and browser store while
  making Office, Tree, Graph, their counts, and search show only the browser's
  selected operational host. Search now occupies one shared top-bar control slot,
  with Graph Fit and zoom beside it instead of a duplicate stage header.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Fixed

- Release candidates now check for newer candidates in their own version line,
  while package-managed installations avoid in-app binary replacement.

- macOS service installation now reports an occupied port instead of claiming
  success while the new World service repeatedly fails to start.

- Plugin actions and panel now launch from the Herdr server without requiring Bun
  on its `PATH`; Bun is needed only to install or build the plugin.

- An occupied World listener now explains how to keep the existing process and
  choose a persistent alternate port during an upgrade.

- Kept a partly clipped Inspector stationary when pointer focus raises it during
  Columns arrangement, while keyboard focus still scrolls it into view.
- Opened terminal file links in the originating Office, Tree or Graph Inspector's Files tab,
  focused the exact selected pane when activating a visual terminal window, and opened a newly
  created Office desk's terminal as soon as its pane was admitted.
- Kept a dragged or resized Inspector from moving focus to its Terminal input
  and scrolling a partly clipped arranged window into view.
- Kept browser-local Office creation ready without first visiting Spaces or
  opening an Inspector, unified seat, room and tab-strip availability feedback,
  and preserved the prior Inspector while bounded exact focus reports failures.
  [Herdr World PR #114](https://github.com/IvoryHeart/herdr-world/pull/114)
- Kept open floating Inspectors visible through failed, stale or bounded World
  observations and through focused tab lists fetched before a new Inspector opens.
  [Herdr World PR #111](https://github.com/IvoryHeart/herdr-world/pull/111)
- Reconciled Android terminal textarea replacements as tail edits so mobile
  autocorrection, deletion and revised text no longer resend accumulated input
  or lose corrections.
  [Herdr World PR #96](https://github.com/IvoryHeart/herdr-world/pull/96)
- Kept Inspector windows responsive while docking, swapping, or changing agents,
  and removed duplicate controls that obscured the selected agent.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Made host navigation and tab selection reopen the matching Inspector without
  switching to the wrong conversation or unexpectedly moving a docked window.
  Office room and seat controls now become available when the scene is ready.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Preserved live terminal and resource tabs while moving between Office, Tree,
  Graph, and Spaces. Floating Inspectors remain movable and resizable on desktop
  and touch devices; compact views keep their resource controls visible.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Kept important agents visible in dense hosts and reported when view limits
  hide other agents. Slow observations no longer block the selected host's view.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Closed an Inspector when its terminal was retired and kept Office room and
  seat controls visible during temporary connection delays.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Restricted privileged browser traffic to the World service, kept disconnected
  hosts read-only, and displayed the release version in the application.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

### Removed

- Removed browser-to-bridge federation, remote World installations and the former
  Host, Origin and cross-origin CSP configuration workflow.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)
- Removed the Rust bridge, vendored Herdr compatibility crate, native Capacitor
  Android build and inherited legacy service/preference migration paths.
  [Herdr World PR #93](https://github.com/IvoryHeart/herdr-world/pull/93)

## [0.1.1] - 2026-09-01

> **Herdr Web baseline:** Derived from v0.5.0 plus the JetBrains Mono Nerd Font fallback merged in upstream PR #74 at
> [`4384c884`](https://github.com/kcosr/herdr-web/commit/4384c884da418ea3f3fb75954da5347b2e12f063).

### Added

- Added an accessible live Graph theme with bounded project/space and attached-terminal topology,
  detected agent or empty-shell identity, stable force layout, search, collapse, pan/zoom/fit
  controls, semantic navigation, connected live terminal overlays, and explicit Open-in-Spaces
  handoff.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

### Changed

- Made Office the default `/` experience, moved Spaces to `/spaces`, retained `/world` as a
  compatibility alias, replaced the Office tab with an Office/Graph World theme selector, made a
  settled fitted camera the Graph default while retaining explicit manual camera adjustments, and
  unified the initial Graph and Office terminal window footprint. Expanded the README and project
  site with privacy-safe Graph showcase captures and an accessible, reduced-motion-aware product
  carousel.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

### Fixed

- Kept World terminal windows resizable and attached to the same live session across Office/Graph
  theme changes, retained a perceptible Graph node connector in desktop and compact layouts,
  including while its space is collapsed, prioritized detected agents at Graph presentation
  bounds, exposed complete terminal state and touch-sized bounded zoom controls accessibly,
  distinguished connecting and degraded retained snapshots from offline hosts, kept movable spaces
  clear of pinned nodes, composed compact theme navigation into one traversable history entry,
  bounded Graph projection preprocessing, skipped inactive Graph work so rapid runtime refreshes
  do not stall Office, and bounded terminal canvas refits and preference writes during rapid window
  resizing so neither World theme can saturate the browser tab.
  [Herdr World PR #73](https://github.com/IvoryHeart/herdr-world/pull/73)

## [0.1.0] - 2026-08-31

> **Herdr Web baseline:** Derived from v0.5.0 plus the JetBrains Mono Nerd Font fallback merged in upstream PR #74 at
> [`4384c884`](https://github.com/kcosr/herdr-web/commit/4384c884da418ea3f3fb75954da5347b2e12f063).

### Added

- Added `herdr-world task-summary` for agent harnesses to publish or clear bounded, expiring,
  session-qualified Office summaries through Herdr's existing pane-metadata contract.
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)
- Added 48 CSS-pixel semantic Office targets and a compact Agents, Rooms, and Desks chooser so
  mobile users can select exact scene identities without relying on small pixel-art hit areas.
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)
- Added a bundled JetBrainsMono Nerd Font Mono fallback for special terminal and LLM output glyphs
  on devices without an accessible Nerd Font.
  [PR #74](https://github.com/kcosr/herdr-web/pull/74), contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin).
  [Herdr World PR #60](https://github.com/IvoryHeart/herdr-world/pull/60)

### Changed

- Made release preparation a reviewed pull-request change, correlated each World release with its
  exact Herdr Web baseline instead of duplicating the upstream changelog, and restricted the
  post-merge release command to verifying exact `main` and creating the immutable release tag.
  [Herdr World PR #63](https://github.com/IvoryHeart/herdr-world/pull/63)
- Replaced the reference-heavy README with a concise user guide covering installation, essential
  advanced usage, contribution and support paths, licensing, acknowledgements, and Pixel Office
  previews for desktop and mobile.
  [Herdr World PR #59](https://github.com/IvoryHeart/herdr-world/pull/59)

### Fixed

- Kept stable README and project-site installation instructions on the npm `latest` and Homebrew
  stable channels, removed release-candidate-only download labels, and made Pages validation aware
  of the selected release channel. Release preparation also keeps the changelog preamble outside
  the fresh empty `Unreleased` section so tag validation sees the intended release boundary.
  [Herdr World PR #64](https://github.com/IvoryHeart/herdr-world/pull/64)
- Stopped Office anchor updates from recursively rebuilding the Pixi scene while idle or resizing,
  keeping the interface responsive without increasing terminal resize traffic.
  [Herdr World PR #62](https://github.com/IvoryHeart/herdr-world/pull/62)
- Released scene-owned Pixi graphics contexts and text styles after each Office redraw so
  long-running sessions do not retain every discarded scene until the tab crashes.
  [Herdr World PR #62](https://github.com/IvoryHeart/herdr-world/pull/62)
- Preserved external Office focus across terminal connection retries so a late
  terminal autofocus cannot consume Escape instead of closing the topmost
  conversation window.
  [Issue #5](https://github.com/IvoryHeart/herdr-world/issues/5),
  [Herdr World PR #61](https://github.com/IvoryHeart/herdr-world/pull/61)

## [0.1.0-rc.15] - 2026-08-30

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Changed

- Made release publication fail closed behind the exact unpublished npm payload's full Herdr plugin
  lifecycle and the generated Homebrew Formula lifecycle on Linux x86-64, macOS ARM64, and macOS
  x86-64. The explicit distribution preflight now exercises those same gates before any tag is cut.
  [Herdr World PR #57](https://github.com/IvoryHeart/herdr-world/pull/57)

### Fixed

- Kept release-smoke Herdr sockets below the macOS Unix-domain socket path limit instead of nesting
  them under the runner's long temporary directory.
  [Herdr World PR #57](https://github.com/IvoryHeart/herdr-world/pull/57)

## [0.1.0-rc.14] - 2026-08-30

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed macOS launchd startup to rely on the plist's `RunAtLoad` behavior, include the failing
  supervisor command in diagnostics, and safely unload a partially bootstrapped service after
  startup failure while retaining recovery state when cleanup cannot be verified.

## [0.1.0-rc.13] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Synchronized the Herdr plugin release smoke with asynchronous startup-hook completion on macOS.
  [Herdr World PR #55](https://github.com/IvoryHeart/herdr-world/pull/55)

## [0.1.0-rc.12] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed the Herdr plugin doctor check to compare the active Node.js executable with the service record.
  [Herdr World PR #53](https://github.com/IvoryHeart/herdr-world/pull/53)

## [0.1.0-rc.11] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Made the Herdr plugin release smoke deterministic across asynchronous startup-hook execution.

## [0.1.0-rc.10] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Accepted GitHub's squash-merge suffix on protected release commit subjects so the release
  provenance gate matches the repository's PR merge strategy.
  [Herdr World PR #47](https://github.com/IvoryHeart/herdr-world/pull/47)

## [0.1.0-rc.9] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added a Herdr-native startup hook that starts the plugin bridge on the next Herdr server restore,
  with documented install, crash-restart, and port-conflict behavior.
  [Herdr World PR #41](https://github.com/IvoryHeart/herdr-world/pull/41)

### Changed

- Updated the project site with tabbed npm, Homebrew, and Herdr plugin installation paths plus a
  concise CLI quick reference.
  [Herdr World PR #42](https://github.com/IvoryHeart/herdr-world/pull/42)
- Kept the primary install tabs to the two commands users need and moved archive and lifecycle
  commands into a collapsed advanced CLI section.
  [Herdr World PR #43](https://github.com/IvoryHeart/herdr-world/pull/43)
- Split the installation card into npm, Homebrew, Herdr plugin, and CLI archive tabs, with
  method-specific advanced instructions and preview/stable channel guidance.
  [Herdr World PR #44](https://github.com/IvoryHeart/herdr-world/pull/44)
- Renamed the user-facing archive tab to `CLI` while keeping archive details in the CLI panel.
  [Herdr World PR #45](https://github.com/IvoryHeart/herdr-world/pull/45)

## [0.1.0-rc.8] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Fixed RC npm publication to pass the downloaded package tarball as an explicit filesystem path.
  [Herdr World PR #39](https://github.com/IvoryHeart/herdr-world/pull/39); release correction:
  [Herdr World PR #40](https://github.com/IvoryHeart/herdr-world/pull/40)

## [0.1.0-rc.6] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added the Herdr World plugin manifest and lifecycle controller. Herdr can install the exact
  release-matched npm payload privately, supervise one loopback bridge per session, and expose
  start/stop/restart/status/open/doctor actions without changing the standalone npm, Homebrew,
  desktop, or Android distributions.
  [Herdr World PR #36](https://github.com/IvoryHeart/herdr-world/pull/36)

### Fixed

- Allowed npm release publication to wait for publish-time malware scanning before verifying the
  immutable version, integrity, and channel pointer.
  [Herdr World PR #34](https://github.com/IvoryHeart/herdr-world/pull/34)

## [0.1.0-rc.5] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Let Homebrew derive the package version from immutable release URLs, avoiding a redundant
  explicit version rejected by current Formula audit while preserving release-state safeguards.
  [Herdr World PR #33](https://github.com/IvoryHeart/herdr-world/pull/33)

## [0.1.0-rc.4] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Allowed the first Homebrew release channel to complete Formula audit and lifecycle validation
  before its declared sibling channel exists in a new tap, with manual runs installing the exact
  native artifacts locally instead of expecting a synthetic GitHub Release URL to exist.
  [Herdr World PR #32](https://github.com/IvoryHeart/herdr-world/pull/32)

## [0.1.0-rc.3] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Fixed

- Updated Homebrew release validation for current name-based audit and trusted-tap requirements.
  [Herdr World PR #31](https://github.com/IvoryHeart/herdr-world/pull/31)

## [0.1.0-rc.2] - 2026-08-29

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added one protected release workflow that assembles exact native artifacts for GitHub, npm, and
  Homebrew distribution, with platform-aware npm bridge selection and stable/RC Homebrew channels.
  [Herdr World PR #29](https://github.com/IvoryHeart/herdr-world/pull/29)
- Added a desktop `install` / `herdr-world-installer` entrypoint that installs the complete
  versioned World bundle for the current user, exposes the `herdr-world` command, and then hands off
  to the consent-based Herdr dependency setup.
  [Herdr World PR #22](https://github.com/IvoryHeart/herdr-world/pull/22)

### Fixed

- Bounded terminal resize traffic during rapid pane and Office conversation resizing, preventing
  resize/output feedback from stalling the page while retaining the latest terminal dimensions.
  [Herdr World PR #23](https://github.com/IvoryHeart/herdr-world/pull/23)
- Treat stale default Herdr sockets as stopped instead of asking to stop a nonexistent daemon, wait
  for an actually compatible server after startup, and print the World URL before the foreground
  bridge begins serving.
  [Herdr World PR #22](https://github.com/IvoryHeart/herdr-world/pull/22)

## [0.1.0-rc.1] - 2026-08-26

> **Herdr Web baseline:** Derived from v0.5.0 plus its next-development marker at
> [`e67537b6`](https://github.com/kcosr/herdr-web/commit/e67537b6bdd99fe489584252ba2f84ea070a3193).

### Added

- Added automated, native Linux x86-64 and unsigned macOS ARM64/x86-64 release builds with archive,
  checksum, architecture, legal-content, launcher, and two-daemon stock Herdr v0.8.2 validation.
  [Herdr World PR #16](https://github.com/IvoryHeart/herdr-world/pull/16)
- Added deterministic production npm/Cargo licence inventories, exact runtime
  closure checks, and release/WebView assembly of the resulting notices.
  [Herdr World PR #9](https://github.com/IvoryHeart/herdr-world/pull/9)
- Added focused contribution guidance and a private vulnerability-reporting
  policy for the public Herdr World repository.
  [Herdr World PR #8](https://github.com/IvoryHeart/herdr-world/pull/8)
- Added Spec 015 work unit 2's focused Herdr Web v0.4.2/v0.4.3 replay: a supervised loopback
  `npm run dev` workflow with child-process tests, and an opt-in bounded terminal screen-reader
  text mirror. The replay preserves downstream World and multi-bridge behavior; Web v0.4.2/v0.4.3
  development/IME/focus/accessibility details are covered by this work unit's focused commits.
- Added `npm run dev` with a supervised loopback bridge/Vite workflow, bounded
  bridge readiness checks, clean child-process shutdown, and `test:dev`
  coverage for startup and signal/error paths. [Upstream PR #57](https://github.com/kcosr/herdr-web/pull/57),
  based on [PR #51](https://github.com/kcosr/herdr-web/pull/51) by Hopkins
  ([@LosEcher](https://github.com/LosEcher)).
- Added Spec 015 work unit 1 compatibility for Herdr `v0.8.2` and exact terminal protocol `20`,
  including the refreshed bridge wire/API slice, frozen protocol fixtures, bounded admission
  diagnostics, safe direct-graphics exclusions, and terminal-bell handling. Web v0.4.2/v0.4.3
  replay followed as a separate focused change.
- Declared the existing Herdr SVG logo as the browser favicon, synchronized
  from the audited Herdr Web upstream head `9897522`. Contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin) in
  [PR #56](https://github.com/kcosr/herdr-web/pull/56).
- Added a bounded Office productivity slice: browser-local restoration of Office window geometry,
  ordering, and scroll position; responsive room sizing; persistent selected-agent callouts for
  optional harness task summaries; and direct-federation Enable all / Disable all bridge controls.
- Added animation-frame terminal refits during Office window resizing to remove the extra inner
  canvas catch-up delay.
- Added an isolated Office settings surface for an optional Prometheus URL,
  with bridge-owned live configuration, per-bridge browser persistence, and
  clear provider health feedback. The generic Herdr Web settings remain the
  only integration entry point so the Office slice can be removed for an
  upstream contribution.
- Added short-lived Office terminal restoration across browser refreshes by
  persisting only qualified pane descriptors and revalidating them against an
  admitted snapshot.
- Restored the graphical Agent Bar as a separate room beside the CEO Office,
  including the Party board, single counter, and compact full-size agent
  sprites, while retaining a semantic keyboard and screen-reader overlay.
  Office room create, rename, and close actions remain capability-gated against
  Herdr workspace lifecycle commands.
- Added a documented `npm run dev:local` workflow that checks the Herdr socket,
  reuses or starts the bridge, and launches the web client with the correct
  development proxy.
- Added exact double-click shortcuts for current Pixel Office rooms and agents across the canvas
  and semantic roster. Direct double-click works without prior selection and reuses the guarded
  Spaces handoff while retaining single-click inspection and accessible inspector controls.
- Added an integrated Herdr World primary view with a deterministic Pixel Office projection of
  shared federated snapshots, live host coverage and filters, a qualified roster and inspector,
  bounded overflow and stale-host handling, responsive and accessible fallbacks, and exact
  revalidated `Open in Spaces` handoff without reload or reconnection.
- Added the federated client base: explicit app-shell and internal-surface seams,
  persistent host profiles, host-qualified runtime and terminal identities, direct multi-bridge
  browser federation, isolated compatibility/failure states, strict non-loopback admission policy,
  and browser/security/independence acceptance gates.

### Changed

- Made the desktop launcher detect a missing default Herdr session and offer an explicit,
  consent-based path to install Herdr from its official installer and start it in a user-selected
  workspace. Non-interactive, custom-session, and custom-socket launches remain fail-safe.
  [Herdr World PR #14](https://github.com/IvoryHeart/herdr-world/pull/14)
- Added a direct, checksum-verified desktop release quick start, an explicit public-platform matrix,
  a minimalist Pixel Office-themed GitHub Pages site, and launch-ready social artwork for the
  Herdr World public preview.
  [Herdr World PR #11](https://github.com/IvoryHeart/herdr-world/pull/11)
- Made the single release command update public README/Pages version references before tagging, so
  desktop assets and the project site publish from the same release operation.
  [Herdr World PR #16](https://github.com/IvoryHeart/herdr-world/pull/16)
- Completed the Herdr World product identity across the visible shell, Android
  application ID (`dev.herdr.world`), and desktop `herdr-world-*` release
  artifacts. Release tarballs now carry the project license, explicit
  third-party notices, retained license texts, upstream record, and source/asset
  provenance. Internal Cargo target and browser-state names remain unchanged for
  upstream comparison and existing-user compatibility.
  [Herdr World PR #7](https://github.com/IvoryHeart/herdr-world/pull/7)
- Established `IvoryHeart/herdr-world` as the independent downstream monorepo,
  renamed the app/package identity to Herdr World, and replaced the overlapping
  Specs 004/010/011 with one practical independence and upstream-sync contract.
- Reconciled the working protocol-20 World baseline with Herdr Web v0.5.0,
  adopting its missing mobile cursor, wrapped-URL copy, negotiated gzip output,
  and Attention-sort recency behavior while retaining World-specific behavior.
  Git records the upstream merge; `UPSTREAM.md` keeps only the current sync point.
  [Herdr World PR #1](https://github.com/IvoryHeart/herdr-world/pull/1)
- Replayed desktop IME composition cancellation/fallback handling and dialog/menu focus restoration
  across Spaces, Office, bridge settings, launchers, notes, and terminal overlays.
- Static bridge entrypoints and public files explicitly revalidate while
  successful content-hashed Vite assets use immutable caching; missing and
  error responses are not marked cacheable. [Upstream PR #57](https://github.com/kcosr/herdr-web/pull/57),
  based on [PR #51](https://github.com/kcosr/herdr-web/pull/51) by Hopkins
  ([@LosEcher](https://github.com/LosEcher)).

- Removed the persistent Office notice/status strip to return its vertical
  space to the canvas; provider details remain available through Office
  settings and the existing CEO boards/sidebar.
- Positioned the graphical Agent Bar beside the CEO Office with a dedicated
  pixel-road separator. CEO furniture and agent sprites remain at their native
  scale; only inter-block spacing and bar spacing are compacted. Room lifecycle
  actions remain disabled when the selected host does not advertise the
  required Herdr commands.
- Made the Office canvas follow the available viewport width and changed room
  placement from a fixed two-column cluster to an elastic full-width grid.
  Moved room rename/close controls into room title bars, moved room creation to
  an in-scene `+`, and removed the global `New seat` control in favour of the
  room-local desk actions.
- Distributed CEO-room boards and reception furniture across the available CEO
  area, expanded the desktop Agent Bar to 560px when space permits, and kept
  furniture spacing stable for rooms in a partial final row.
- Matched the Agent Bar Party count to the rendered bar occupancy, packed the
  first agent row against the counter, added drinks to the counter, and kept a
  disabled `+ / ROOM FULL` affordance visible after the eighth desk.
- Changed room placement to sequential natural-width row packing: each row fits
  as many 2–8-seat room templates as it can, later rows are not constrained by
  a wide room above them, and all room gaps remain snug and consistent.
- Added a persisted Office layout preference for left, center, or right room-row
  alignment, with left alignment as the default; CEO Office and Agent Bar placement
  remain dedicated and unaffected.
- Added pixel-road separators between responsive room rows and columns, nudged
  reception tables inward at the CEO boundary, and gave each visible Agent Bar
  agent an aligned glass alongside a rear shelf of drinks.
- Refined the Agent Bar composition by raising the counter and visible agents,
  keeping their glasses on the counter, and moving the bottle row into the
  lower edge of the room.
- Documented Office settings verification and tracked the usable-but-not-yet
  smooth terminal refit during conversation-window resizing as SUG-028.
- Kept the delivered Herdr sidebar shared across Spaces and Office, moved live admitted-state
  coverage onto a CEO-room blackboard, opened the CEO/reception composition for future plugin
  boards, shifted room furniture down within the existing wall clearance, and refreshed the Agent
  Bar with a warm Claw-Empire-inspired bar setting using the existing character art. The board now
  uses a legible three-column/two-row metric grid with a compact single-dot state cue, and the
  Agent Bar now packs full-size agents around one counter.
- Remodeled Pixel Office around qualified Herdr topology: tabs are desks; `working` and `unknown`
  agents work or stand in their exact workspace; `blocked` agents wait at horizontal host reception
  conference tables; and `idle` and `done` agents move to the shared Agent Bar. The reception floor
  retains one uncrowned user/CEO, reserves unused width for future displays, and gives CEO,
  reception, occupied, and empty desks visible chairs.
- Established one persistent Herdr client frame and federated runtime above the `Spaces | World`
  view boundary. `/world` is addressable browser state inside that frame, while Spaces retains its
  delivered sidebar, terminal, split, Notes, and operational behavior.
- Mobile terminals now use a static visible cursor instead of a blinking cursor, reducing continuous
  canvas redraw work on resource-constrained devices. Desktop cursors continue to blink.
  [PR #60](https://github.com/kcosr/herdr-web/pull/60)
- Terminal output now negotiates gzip compression between matching web apps and bridges, while
  remaining compatible with older versions and keeping incompressible updates raw.
  [PR #59](https://github.com/kcosr/herdr-web/pull/59)
- Changed the Attention agent sort to break ties within an attention band by the most recent agent
  status change, matching Herdr's Priority agent panel, and kept the existing bridge, Space, and tab
  order as the fallback for agents with no recorded transition.

### Fixed

- Kept the official Herdr installer's stdout diagnostics out of the launcher's resolved executable
  path, allowing guided macOS installation to stop an incompatible daemon and continue startup.
  [Herdr World PR #21](https://github.com/IvoryHeart/herdr-world/pull/21)
- Added a guarded same-tag prerelease reissue mode for correcting an unannounced candidate without
  inventing another release-candidate number. It retains all normal remote, tag, release, and test
  safety checks and cannot replace a stable release.
  [Herdr World PR #20](https://github.com/IvoryHeart/herdr-world/pull/20)
- Fixed guided desktop setup bypassing an incompatible detached Herdr server merely because its
  socket still existed. Interactive launches now offer to install/update Herdr, explicitly warn and
  ask before stopping the old server, then start the compatible server in the selected workspace.
  [Herdr World PR #19](https://github.com/IvoryHeart/herdr-world/pull/19)
- Fixed the packaged launcher failing with `bridge_args[@]: unbound variable` when invoked without
  bridge arguments under the Bash 3.2 version shipped by macOS, and added a native packaged-launcher
  regression check. [Herdr World PR #18](https://github.com/IvoryHeart/herdr-world/pull/18)
- Made release aggregation accept the equivalent macOS Mach-O architecture descriptions emitted
  by macOS and Linux `file`, while still requiring the expected executable format and CPU.
  [Herdr World PR #17](https://github.com/IvoryHeart/herdr-world/pull/17)
- Made the release helper mark SemVer prerelease tags as GitHub prereleases automatically while
  leaving stable versions unchanged.
  [Herdr World PR #15](https://github.com/IvoryHeart/herdr-world/pull/15)
- Made release creation fail closed unless both `origin` URLs and the explicit GitHub CLI target
  resolve to `IvoryHeart/herdr-world`, preventing a checkout's default upstream from receiving a
  Herdr World release. [Herdr World PR #10](https://github.com/IvoryHeart/herdr-world/pull/10)
- Fixed icons rendering slightly off-center in square icon buttons by resetting
  browser-default button padding and removing the compensating filter-icon transform.
  Contributed by [Philippe SEGATORI (@tigitz)](https://github.com/tigitz) in
  [PR #55](https://github.com/kcosr/herdr-web/pull/55).
- Fixed the Pixel Office Economy board overflowing long Anthropic model names into the token
  column by displaying the model family and version only, for example `Haiku 4.5`.
- Fixed saved Office observability settings being applied after the first data refresh by waiting
  for configuration synchronization and the provider's initial Prometheus query.

- Fixed Office room roads being visually swallowed by room borders by widening
  the packed room gap to the road width, and corrected vertical-road lane marks
  to run vertically while horizontal-road marks remain horizontal.
- Increased the vertical gap between room rows so row headings no longer cover
  the horizontal road separator.
- Fixed development-mode Office renderer cleanup so an older asynchronous Pixi
  initialization cannot remove the active canvas created by a newer initialization.
- Mobile terminal copies now remove canvas row gaps that split HTTP(S) links, including indented
  alphanumeric continuations when terminal edge metadata is unavailable, while preserving ordinary
  line breaks.
  [PR #61](https://github.com/kcosr/herdr-web/pull/61)
