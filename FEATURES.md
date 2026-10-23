# Herdr World Features

A Web/PWA client for a running [Herdr](https://herdr.dev) server.
[Install it](./docs/DEPLOYMENT.md) or follow the [tutorial](./docs/TUTORIAL.md).

## Visual control plane

Town, Board, Desk and Spaces are World's views. Office, Tree and Graph have been
retired: `/office` opens Town, and `/graph` and `/tree` open Board. Board and
these redirects are included in [0.2.6](./docs/releases/v0.2.6.md).

- **Town** is the default view (`/town`); the root URL opens it too.
  Each host is a building, each workspace a room, each tab a team table and each
  pane a seat. Plain terminals show prompts. Additional panes beyond the drawn
  seats remain available through the table's count and chooser. Each table
  carries its tab's name on a nameplate at its front edge. Agents go by the
  name Herdr gives them (`firstmate`), else their harness (`claude`); window
  and Inspector titles put the name first (`firstmate · claude`).
  - The Town board counts agents working, needing you and done, with spend
    when a metrics provider is configured. Wide screens show it at the top
    left; phones show a compact chip under the search bar that opens it.
  - Blocked agents queue at reception oldest first. Finished agents wait there
    until you open their terminal or mark that completion reviewed, then join
    idle agents in the lounge. Movement only represents state.
  - Each agent has one window: World's Inspector, with one top selector
    (**Chat**, **Terminal**, **Changes**, **Files**, then **Commits**).
    Tapping an agent or its table, activating it (double-click,
    **Shift+Enter**), the needs-you list, **N** and **Next** open that window on
    **Chat**: the conversation's latest 200 entries, which scroll inside the
    window, with **Jump to latest** when you have scrolled back and the
    composer always at the bottom. Reopening or redocking the window keeps the
    conversation. In Town it
    docks on the right by default (**Menu → Inspector opening**), can be
    undocked, and keeps the dock it was left with. On a phone, the Chat view
    shows only its own composer, without the terminal key bar.
  - The top selector follows the window's own width, docked, floating or on a
    phone: labelled from 640px, icons (with their names as tooltips) below
    that, and below 360px only the active view, with the others under ⋯.
  - The Town master's chat (**Menu → Town master**, `firstmate` by default,
    matched against the agent's Herdr name, then its label) opens docked on
    Chat once per visit on wide screens, without moving the pane's focus.
  - Hovering an agent shows a small card as a preview: its latest message from
    Chat's conversation read model, rendered as Chat renders it (never terminal
    text; an unavailable conversation shows Chat's reason), a question when
    recognized and supported answer buttons. It is read-only: **Open chat**
    (or **Follow up** for a finished agent) opens the agent's window on Chat,
    where replies and attachments go. The card refreshes when the conversation
    changes, without polling.
  - Tapping an agent or its table brings the agent back: from reception or the
    lounge it walks to its desk and stays there until its status changes. A
    table stands for an agent that needs you (waiting, then finished) before
    the one seated there. **Menu → Agents open** chooses whether that tap opens
    the chat (the default) or the terminal, in Town, Board and Desk alike; either way the tap does not mark
    finished work reviewed. **Open terminal** in the peek does, as before.
  - A seated agent with a quest (its own todo list, plan, Codex goal or loop)
    shows a blue pennant (green when done, amber when blocked) beside it in
    a room or at a desk, with a progress bar when the quest has steps; the
    pennant leaves with the agent. Hover or tap the pennant for **Quest**, its title and progress.
  - **Open terminal** in the card's header opens the live pane; **Inspector**
    opens files and changes. **Next** opens the next waiting agent's window,
    then finished agents' if none wait.
    The needs-you list becomes a bottom tray on phones and hides when no agent
    is blocked. Review marks acknowledge a specific completion in this browser,
    without certifying its correctness.
  - **+**, **−** and **ALL** navigate between town, building, room and desk
    detail. Drag to pan; focused arrow keys pan too. Tap a room to zoom in.
    Phones stack buildings vertically; large towns can initially show roofs.
    **Town calm motion** reduces ambient animation. Room actions support
    workspace/tab creation and room management on the captured host.
  - Drag a table onto another room of the same host, or an agent onto another
    table, to move it (hold, then drag on phones; **M** on a focused table or
    agent from the keyboard). A carried table lifts and sways after the
    pointer, lands with a bounce and a puff of dust, and shakes and springs
    back when a move is refused; calm and reduced motion keep it under the
    pointer and end with a short fade. The live panes move, agents keep running, a failed
    move attempts rollback and reports partial or unknown results. Moving a
    room's last table asks first because the room closes. When a table closes, the tables after it close up.
  - Tables sit in Herdr's tab order, left to right and row by row, so moving a
    tab in Spaces or Herdr moves its table. Drag a table onto another table in
    its room to put it in that place, or onto the room's free spot to put it
    last of the tables shown (**M** lists the same places). Rooms extend as
    tabs open, up to 127 tables: wide screens show three columns of rooms up
    to eight tables wide, portrait and half-width screens two columns up to
    six, and phones one column up to four, growing downward. A growing room
    moves only the rooms below it, and never while you hold the town. A room
    with more than 127 tabs keeps its three newest and busiest tables and
    hides idle ones first. Town asks Herdr to move the tab and
    shows the new order when Herdr reports it; agents stay with their table.
  - **Teams.** Tables whose agents know each other are drawn inside one wall
    with a connector: a spawned agent is joined to the agent that started it,
    and a manual group with dotted lines; stale links are faded while a host
    is offline, and dropped once its agents have closed.
    Drag a table onto another table and hold it there a moment: it snaps to
    that table (**Group with …**), and dropping groups them. Town moves it to
    that room if needed and seats its tab beside the other's in Herdr. A quick
    drop keeps meaning a move or a reorder, so the gestures stay separate.
    Drop a table you grouped on its own room's bare floor (not the free spot)
    to leave its group; a spawn link stays, since Herdr's stamp records it.
    **M** on a focused table offers the same as **Group with…** and **Leave
    the team**, and the table's accessible name lists its teammates. A
    pinned table joins a team only in its own room, and keeps its place.
  - **Pin a desk** from its agent window's **⋯** menu (**Pin desk in Town**),
    on a phone too. A
    pinned table wears a pin and keeps its place: tab reorders, a room growing
    or Town's own placement leave it, and it cannot be dragged until you unpin
    it (other tables fill the free places in tab order). In a room with more
    tabs than Town shows, pinned tables (and their agents) are always shown, before the newest and busiest. Its agents stay at it:
    they never go to the lounge, leave only to wait at reception (blocked, or
    finished and not yet seen) and walk straight back once you have seen them.
    The pin is a World view setting, saved on the World service beside
    terminal colours, so every device sees it; Herdr is unchanged, and
    Spaces' tab pins (close protection in this browser) are separate. A pin
    follows its tab when the tab moves to another room and goes when it closes.
  - Cached failed-host buildings stay stale and non-actionable. Search and Hosts
    use the shared aggregate. Reception and lounge positions only show status;
    only an explicit move changes Herdr's layout, always within one host.
  See the [Town exercise](./docs/TUTORIAL.md#town).
- **New agent and agent profiles.** **New agent** starts an agent in a new
  tab of a room you choose, from a profile (one tap) or from any agent kind the
  host's Herdr supports. It is in the Actions menu of Town and Board, on each
  Town room's plaque (on
  phones, tap a room, then **New agent**), beside **+** in Spaces' tab bar,
  and in Board's New tab dialog. World creates the tab, starts the harness
  through Herdr, waits until it is ready, then sends the first prompt; if the
  harness stops on a question (such as Claude's folder trust) or exits at
  once, it says so and offers to open the tab.
  - The launcher shows whether each harness is installed and logged in on the
    host, asked with the harness's own status command (`claude auth status`,
    `codex login status`; Pi reports only whether it is installed). **Log in**
    opens a small tab and shows the harness's own login command to copy and
    run there. World never types into it, and never sees or stores
    credentials.
  - **Agent profiles** (Menu → Agent profiles, Actions → Agent profiles, or
    Edit profiles in the launcher and Board) set a name, home room, role,
    colour, brain (harness, model, Codex reasoning effort, permission mode),
    skills (the room's and host's `SKILL.md` folders), tools, a starting brief
    with `{{name}}`, `{{task}}`, `{{room}}` and `{{spawned_by}}`, and a Town
    look: skin, hair, outfit (including a dress or a captain's jacket),
    colours and an accessory, with a live preview. Reviewer, Builder,
    Designer and FirstMate are starters you can edit or delete.
  - At launch a profile becomes the harness's own configuration: Claude Code
    gets an inline subagent definition (`--agents` and `--agent`, the fields of
    `.claude/agents/*.md`) and `--permission-mode`; Codex gets `-m`, `-a`,
    `-s` and `-c` options with the role as developer instructions; other kinds
    start plainly and get the role in their first prompt. The editor shows the
    exact command. The new tab takes the profile's colour and its agent wears
    the profile's look in Town.
  See the [New agent exercise](./docs/TUTORIAL.md#new-agent).
- **Terminal colours.** Every tab has one colour, shown as the tab in Spaces,
  the card in Board and its table in Town (tabs beyond a room's drawn tables
  show it in Spaces and Board). A tab starts with a stable default colour, or
  its workspace's Board colour; choose another from the swatch beside the
  terminal's name in its header (desktop window or phone app bar), the
  terminal window's menu (**Colour**), the tab's menu in Spaces, the swatch in
  an agent's peek in Town, or the selected card in Board, and reset a tab's own
  colour with **Default colour** the same way. Herdr has no tab colour, so the World service
  saves the choice keyed by host and Herdr tab ID, the same on every device. A
  closed tab's saved colour is dropped.
  - Workspaces and hosts have colours too. A workspace's colour is its Town
    room's carpet (swatch beside the room's name), its Board card and a dot in
    the Spaces sidebar (its menu offers the palette); its tabs without a colour
    of their own take it. A host's colour is its Town building's roof (swatch on
    its reception board), its Board zone (swatch on the zone label) and its
    Spaces header; it is not passed on to tabs. **Default colour** returns a
    place to its own default.
  - A desk moved to another room keeps the colour it showed, even a default or
    its old room's, saved as its own colour: it no longer follows its room's
    colour, and **Default colour** resets it to its new tab's default.
  - A spawned agent's tab without a colour of its own takes the colour of the
    tab that spawned it (before its workspace's colour), and keeps following it
    when moved. A chosen colour always wins.
- **Agent interest.** The button beside an agent's name in its Inspector
  header in Town, Board and Spaces sets **Watching** (the default), **Muted**
  or **Focused** for that agent, saved by the World service for its terminal on
  every device. Chimes
  read it: a muted agent never chimes, and while a focused agent is reachable
  only focused agents and the Town master's needs-you chime (Watching then
  says it is quiet). A focus on an offline host silences no one until the host
  is back. Interest never hides
  anything from reception. It follows the terminal through moves, and goes
  when its host shows the terminal has closed, including after reconnecting.
  A failed save shows an error and keeps the previous choice; reopen the
  button to retry.

- **Board** (`/board`) shows hosts as zones, workspaces as cards and tabs as
  cards around their workspace, beside your notes. Cards are elastic while you
  move them (on phones, hold a card still before dragging it; a quick swipe
  pans the board, as in Town) and settle within a second; workspaces fold into a count and open
  into free space; Tidy (with Undo) rearranges a workspace or the board and
  carries strung notes along. Zoomed out, workspaces show a square per pane.
  - Tapping or double-clicking a tab or pane row opens an agent on Chat (as in
    Town, by **Agents open**), and a plain shell, or an agent without Chat, on
    its terminal.
  - **Pin** in a selected card's bar keeps the card where it is: it shows a
    pin, and placement, Tidy and settling leave it until **Unpin** (a drag
    still moves it). On a phone, where the card's terminal covers Board, the
    pin in the terminal's header pins its card. Pins are saved with the board
    on the World service.
  - Tabs list each pane as a row; plain-shell tabs look like terminals; only a
    working agent's tab (or the selected one) pulses (a ⋯ setting).
  - An agent with a quest shows a ⚑ chip with its progress (such as 2/5, or
    Loop ×3); hover it for the quest and the current step.
  - **+** on a workspace opens New tab (Terminal, one of your agent profiles,
    or any agent kind the host's Herdr supports, an optional name, then
    Create; a note's Start an agent uses the same dialog, and **Edit profiles**
    opens the profile editor); **+** on a host creates a workspace. Workspace cards count their
    agents by status; tabs show their terminal colour and workspaces take a
    colour the user picks, while status keeps its own colours.
  - Notes and strings are saved by the World service and shared across your
    devices. Strings attach to an exact pane, tab or workspace; a note strung to
    a pane is sent to its agent only when you press Send. When you make the
    string, World records the agent you saw in the pane, once it confirms that
    agent (by its Herdr session) is still there; otherwise the first Send asks. Send checks the runtime, the witnessed
    pane and terminal, and that agent. If another agent now holds the pane,
    even in the same terminal, nothing is sent: World names the new agent and
    sends to it only if you choose **Send to** it. If the agent changes while
    the note is being sent, World says it may have reached another agent.
    A note offers **Start an agent** in a chosen workspace: World starts the
    agent in a new tab and sends the note once it is ready.
  - Drag a tab onto another workspace of its host to move it (asks first).
    On phones, hold a card still before dragging; adding a second finger switches
    to pinch zoom without committing a move. Settling pauses while you type in
    an open terminal.
  - After a Herdr restart, strings that cannot be confirmed ask Keep or Detach;
    strings whose target closed wait in Needs a home. Selecting a card opens
    the shared Inspector. Development builds add an event trace for bug reports
    ([development tools](docs/development.md#development-tools)).
  - **Work** (the pull request button in Board's controls) lays your pull
    requests out as columns: In review, Fixing (changes requested, checks
    failing or conflicts), Green (checks pass, a required review is pending),
    Ready to merge (approved, or passing where no review is required) and
    Merged; the Tickets tab
    groups Jira tickets and assigned GitHub issues by status. Each card links
    to the pull request or ticket and names the agents working on it; tap an
    agent to jump to its card. Escape, Back or a press outside closes it. See
    [Sources](#sources-github-and-jira).
  See the [Board exercise](./docs/TUTORIAL.md#board).

- **Desk** organizes the filtered hosts' agents by what
  they need from you rather than where they run:
  - **Needs you** lists blocked agents, oldest first, with the question and choices
    read from the agent's screen.
  - **To review** lists finished turns with your request, the agent's closing
    report, how long it ran, its tool calls and the files it edited, all read from
    the session transcript. **Mark reviewed** (`E`) clears a turn in this browser.
  - **In flight** lists working agents with their current request and a live line
    from each terminal. Quiet agents collapse below.
  - **Agents** lists every agent in the host filter, those you recently opened from the
    Desk first, then each workspace by recent activity. **Reviewed** lists the
    stops you marked, newest first, with **Reopen**; marking offers **Undo**.
  - On wide screens, opening a card snaps that agent's Inspector to the right (on
    Chat, or the terminal when the agent has no Chat or **Agents open** is set to
    Terminal) beside the Desk as a reading pane and folds the lanes
    into one queue. `J`/`K` preview the next agent there, `Enter` opens it using
    **Agents open** and `Esc` closes the pane. Phones open the Inspector full screen.
  - One search (`/`) filters every mode by agent name, thread title, harness,
    workspace, tab, folder, request and report. Agents are named by the thread
    title their harness writes to the terminal when they have no Herdr name.
  - `J`/`K` move between cards; `Enter` opens the agent's Inspector using **Agents open** to
    answer, review, or watch. Hosts outside the filter appear as summary chips.
- **Spaces** is the focused operational workspace: terminals, files, changes,
  annotations, worktrees, and Agent History for one selected connection.
- **Town**, **Board** and **Desk** show the aggregate of local and SSH hosts.
  **Hosts** defaults to All hosts and persists an explicit host set independently
  of **Manage connections**. Filtering preserves open resources and terminals;
  removed saved identities are pruned, with an explained return to All hosts
  when none remain. Offline hosts keep labelled roots; an empty catalogue offers onboarding.
- Inspectors and terminals capture their own host, runtime generation and resource
  identity. Focus and filters cannot retarget them. Global creation confirms one
  destination; room creation inherits its room. Notifications outside the filter
  open a labelled Inspector with an explicit Reveal in Hosts action.
- Search covers observed entities beyond renderer limits and pages matching results.
  Counts distinguish observations, rendering omissions and unavailable coverage.
- Use **Arrange windows** in the shared shell to show the active terminal alone,
  cascade open windows, fit them in columns or rows, tile them in a grid, or
  restore their previous positions. Spaces arranges the focused workspace's
  existing tabs; visual views arrange their open, non-minimized Inspectors. The desktop controls sit in the top bar; mobile puts it in the ellipsis-expanded controls. The same
  placements are in **Actions** and can be given custom keyboard shortcuts;
  none are assigned by default. Layout
  choices that cannot fit explain why.
- Inspectors and arranged Spaces windows share snap, minimize, maximize/restore,
  close and all eight resize handles. Each window has one bar: its name, a
  location line, the view selector and **⋯**, maximize and close. **⋯** holds
  minimize, the snap choices and float. Tapping the location line under the name
  shows the branch, worktree and PR status, replacing the card above Changes. In
  Town the window takes the Town look (portrait, pixel name, status pill, chunky
  buttons, **‹ Back**). On a phone the window fills the screen like the
  terminal: its bar shows the name and status, and **⋯** switches the view
  (Chat, Terminal, Changes, Files) or switches to another agent or terminal. Opening or focusing a window preserves other
  placements; snapping into an occupied region overlaps without rearranging it.
  Tiled windows share resizable dividers. **Open windows** restores minimized windows.
  Window close dismisses presentation; native tab closure remains separate.
- Menus, dropdowns, pickers and the workspace list opened from a terminal's
  title close top first: Escape and Back close only the topmost one; a press
  or tap outside all of them (on the terminal, say) closes them all, so one
  tap shows the terminal, and a press inside a lower one closes only those
  above it. Escape, Back or a choice returns
  focus to where it was, such as the terminal. The phone's Tabs sheet
  and Composer close with the phone's Back.
- Mobile shows one active window and preserves desktop positions. The on-screen
  **Back** first closes an open menu or the workspace list (opened from the
  terminal's title), then returns from a terminal to the visual view even with
  Composer open; the phone's own Back closes Composer first, then the terminal. Tabs and More stay in the shared top app bar; More exposes Arrange windows.
  Tabs also restores minimized windows and retains native tab actions. The duplicate
  list icon and mobile tab strip are hidden. The outer shell coordinates terminal sizing with the keyboard viewport.
- A Spaces tab window shows that tab's Herdr split panes. An Inspector in a visual
  view also shows the selected tab's split panes in one window; selecting a sibling
  pane keeps the same Inspector and updates its pane-specific resources. When the
  Spaces Inspector is on Terminal, **Focus tab window** goes to the active tab
  without attaching a second terminal.
- A failed host may retain its last observed topology as visibly stale,
  never actionable. Selecting a live entity revalidates its connection generation
  before opening the same terminal or host-specific Inspector context.
- A slow host does not hold back another host’s controls: World returns a
  complete host list within 20 seconds, marks unfinished host views stale, and
  refreshes them when their observations complete.
- The **Actions** command menu stays at the right of the top bar in every view
  (`Cmd+K` on macOS, `Ctrl+Alt+K` elsewhere). Use it for workspace/tab creation,
  window arrangements and the selected target's available resource actions.
  Check the selected host and target before acting. A host, generation or
  observation change invalidates an open target; Actions does not send input
  or assign tasks to an agent.
- World runs as one application and one browser origin. No remote World/Roamgate
  service or browser bridge URL is required for an SSH host.

### Sources: GitHub and Jira

World reads your pull requests and tickets itself; there is nothing else to
install, and every source is on by default. Open **Settings → Sources** to see
each source's state, switch it off or configure it.

- **GitHub** uses the GitHub CLI signed in as the user that runs World (`gh
  auth login`): open pull requests you opened, were asked to review or are
  assigned, every pull request you opened that was merged in the last 7 days
  (change the window in **Settings → Sources**, 1 to 90 days) and issues
  assigned to you, each with review state, checks and mergeability. World
  stores no GitHub credentials. Work's **Merged** and **Done** columns group
  cards by the day each was merged or resolved, newest day open; tap an older
  day to open it.
- **Jira Cloud** needs a site, your account email and an API token. The token
  stays in World's private storage on the service and is never shown again;
  changing the site or email removes it, so enter the token again with them.
  The filter (JQL) defaults to tickets assigned to you or that you watch.
- An agent is linked to the pull request whose branch its checkout is on (the
  branch's own repository, or fork, is a GitHub remote of that checkout), to a
  pull request it reported with
  `herdr-world agent-checkout --pr`, and to a ticket whose key its branch names
  (for example `abc-12-fix-login` and `ABC-12`). Its Town desk shows the badge
  on its nameplate (`#123 ✓`, `#123 ✗`, `#123 ●` or `ABC-12`), and Board's Work
  lens names it on the card. A link holds only for the agent session and
  Herdr runtime it was made in.
- **Your open pull requests** get a card in Work with CI on the head (a dot
  per check), each rev agent's latest result ("per rev4's comment", read from
  its `RESULT #N: …` line; GitHub can't take your own approval, so reviews are
  comments) and your merge rules: not a draft, every finding confirmed, CI
  green on the head, mergeable, and screenshots for a change to the web app
  or site. Each rule shows ✓, ✗ or ? (World can't tell; a confirmation of an
  older head is ?). **Details** lists the failing checks with links, the
  reviewers, the head commit and how far it is behind its base. A card says
  **Ready to merge** when every rule holds, and **Stalled** when CI failed on
  the head and its agent is idle.
- **Merge…**, **Close…** and **Mark ready…** (for a draft) open a sheet that
  says exactly what happens; nothing runs until you confirm. Merge makes a
  merge commit, keeps the branch and refuses if anyone pushed since you
  looked; failing rules make it **Merge despite N failing rules**. GitHub's
  answer, or its reason for refusing, shows on the card. World never bypasses
  branch protection: while GitHub requires a review, the card offers **Open
  on GitHub** and **Copy merge command** instead of Merge. The same card
  opens from the pull request's badge on its agent's Town desk (a sheet on a
  phone).
- A source that is not signed in or configured says how to connect it (Work
  shows a quiet **Set up** button for one you never set up); the views work
  without it. The service refreshes at most once a minute while a visible
  browser tab shows sources, answers at once with what it has while a refresh
  runs, and the browser never contacts GitHub or Jira.

### Retired views and runtime boundaries

Office, Tree and Graph are retired. Bookmarks still work: `/office` opens Town,
and `/graph` and `/tree` open Board. The Inspector opening preference and Town's
calm motion keep their saved values; Office's room alignment and long-title
settings are gone. The optional Prometheus cost metrics now appear on the Town
board; Board's notes and strings do not depend on Prometheus.

World admits simultaneous qualified local and SSH contexts. Runtime replacement
retires only its own windows and pending work; whole-World disconnect or
authentication loss retires all old leases. Unacknowledged input and mutations
are never automatically replayed; refresh the exact target before retrying.
The responsive installable PWA is the mobile client.

### Session task summaries

Agent harnesses can use `herdr-world task-summary` to publish a short, expiring,
session-qualified description of current work for an exact local or fixed-policy SSH
Herdr pane. The Inspector shows it only while the current
agent session matches the report. Herdr owns expiry; the command does not infer work,
assign tasks, or provide a Clear operation.

### Teams and spawn stamps

World groups terminals that know each other. Each relation lists its evidence,
one entry per source, with the source's system of record and whether it holds
now: a **spawn** (Herdr pane metadata while it lives, then World's saved copy)
or a **manual group** (saved by World). Evidence for a terminal that is gone or
on a stale host is shown as stale, not dropped. Herdr records no creator for a
tab or pane, so a spawner stamps the child:
`herdr-world stamp CHILD_PANE PARENT_PANE` (`bun run agent:stamp --` in a
checkout). Board's **Start an agent** stamps the new agent when its note is
strung to one pane. Town draws teams as walls and connectors; Board strings
related cards and groups a tab dropped on another tab, or chosen with
**Group…** and a tap; **Ungroup** undoes it.

### Agent CLI (`herdr-world --skill`)

Agents change World objects themselves from their pane, through the running
World service. `herdr-world --skill` prints the guide; commands answer in JSON
when piped, with stable exit codes:

- `colour set|reset`, `board card pin|unpin|move|group|ungroup|colour`: Board
  cards and tab or workspace colours. Recorded with the agent and time;
  `history` lists changes and `undo <change>` takes one back.
- `town desk move … --herdr`: reorder a desk in its room with Herdr's tab
  order, as a drag in Town does. It needs `--herdr` because it changes Herdr,
  and World cannot undo it.
- `ask "…" [--options a,b] [--owner-only] [--wait]`: a question for you. It
  appears first in Town's **Needs you** list, where you pick an option or
  type an answer; `--wait` blocks until then. Another verified agent (never
  the one that asked) may answer a question that is not owner-only.
- `result --task ID "…" [--pr N] [--status done|blocked|failed]` and
  `result ls`: task results kept by World, instead of terminal scraping.
- `spawned-by <parent-pane>`: the spawn stamp, made by the child itself. It
  is display-only Herdr pane metadata, so it needs no `--herdr`; the parent
  it names is the child's claim.
- `whoami`, `ls`, `history [--actor]`.

World checks who is calling: the CLI sends its `HERDR_PANE_ID`, and the
service accepts it only when the calling process runs in that pane of a local
Herdr (the pane's shell or foreground process is among its ancestors).
The CLI reaches only a World service on the same machine, with a token
derived from the service's signing secret that cannot log a browser in.
Otherwise the change is labelled unverified, or "terminal with no pane" when
no pane is named, since any process can leave it out; `me` and `spawned-by`
need a verified pane. The CLI never
merges, deletes panes, tabs or workspaces, or reaches outside World.

### Agent checkout context

An active agent can report its exact checkout once with `herdr-world
agent-checkout /absolute/checkout --pane w1:p1`. The Inspector reads branch and
bounded changed-file status from that checkout on the same qualified connection,
and labels any optional HTTPS link as **Reported PR**. Reports belong to the
exact active session without a timer; session replacement or a Herdr restart makes
the Agent checkout unavailable. **Workspace changes** remains an explicit, separate
choice. Agent checkout has no Git mutation controls or Clear command.

## Workspace, Tab, and Pane Navigation

- Browse workspaces and recognized agents; create, rename, focus, pin, or close
  workspaces and create, rename, colour, switch, or close tabs.
- Group linked Git worktrees under their repository. Pin workspaces/worktrees
  to the top and collapse groups; preferences stay in this browser.
- Split panes right/down, resize boundaries, focus neighbors, zoom, or close.
  Drag a pane handle onto another tab in the same workspace, onto a pane edge
  in that tab, or onto **+** to break it into a new tab. Hover a tab to open its
  panes before dropping. Overflowing desktop tab strips offer scroll controls.
- Search workspace, worktree, file, tab, pane, and agent actions in the command
  menu (`Cmd+K` on macOS, `Ctrl+Alt+K` elsewhere). A workspace-relative or
  absolute path opens the file.
- Toggle **Zen mode** (`Cmd+Shift+Z` on macOS, `Ctrl+Alt+Z` elsewhere) to hide
  the topbar, tab strip, and sidebar and run the terminal flush to the window.
  Hovering the Exit Zen tab slides the topbar back, and it stays while one of its
  menus is open. The sidebar still toggles inside Zen and returns to its prior
  state on exit; split layouts keep pane borders. Every World view opens in
  Zen by default, with one choice shared by Town, Board, Desk and Spaces; the
  settings menu's **Zen mode** switch turns it off or back on. While Zen is on,
  a view picker beside Exit Zen switches between the views. On a phone, Zen
  hides the top bar and bottom navigation on every root screen, Spaces' list
  included; a corner button opens the views and **Show the bars**. A terminal is
  a detail screen and keeps its own bar, with Back. Stored in this browser.

Herdr 0.9.0 uses **Local navigation** per browser/connection; legacy connections
use **Shared navigation**. Reconnect preserves live selections; reload starts
from Herdr's selection. Closing/moving a selected pane selects a remaining pane
in its tab, then a remaining tab/workspace. Topology changes, terminal sizes,
and same-tab pane focus (including `follow` cwd) remain shared.

Creation preserves Herdr's cwd policy and needs an open, connected source
terminal tab; unavailable sources show an error. An empty session can create its
first workspace directly. See [compatibility](docs/DEPLOYMENT.md#herdr-compatibility).

### Recent Pane Switcher

The switcher includes the 12 most recently focused live panes plus the current
layout, across tabs/workspaces. Entries show workspace, tab or cwd, and agent
icon/status. Closed panes leave history automatically. The keys below use the
macOS preset; see [other platform bindings](#keyboard-shortcuts).

| Key | Action |
| --- | --- |
| `Ctrl+Tab` | Open at the previous pane; hold Ctrl and repeat Tab to advance |
| `Ctrl+Shift+Tab` | Move backward |
| `Up` / `Down` | Move through entries |
| Release `Ctrl` or press `Enter` | Switch |
| `Esc` | Cancel |

### Pane Search

`Alt+K` opens search over every live pane on the selected connection, including
panes absent from the recent switcher. Filter by workspace, tab, cwd, agent name,
or status. Search terms can appear in any order and must all match; results
retain their recent-first order. Use Up/Down or Tab/Shift+Tab to choose, Enter to
switch, and `Alt+K` or Esc to close. Releasing the opening modifier does not
commit a search selection. Press K in the recent switcher to convert it to search.

## Full Browser Terminal

- Display Herdr's server-rendered terminal at browser rows/columns, with splits.
- Send normal input, modified Enter, macOS line-editing shortcuts, multiline
  paste, IME composition, and rapid CJK punctuation.
- Scroll history by wheel, trackpad, touch, or half-page
  `Alt/Option+Page Up`/`Page Down`. Full page keys go to terminal apps (such as
  nano) or Herdr history when the shell owns them; mobile buttons route the same
  way. Endpoint history needs advertised support; disabled controls explain why.
  Explicit half-page shortcuts remain history actions in mouse-aware apps.
- On Herdr 0.9.0, clicks/drags/wheels use pane-local cells in mouse-aware apps.
  Select browser text with Option-drag (macOS) or Shift-drag (elsewhere);
  ordinary output needs no modifier. Selection pauses visible endpoint output
  until cleared, then catches up. Drag past pane edges to scroll and copy
  offscreen rows. Release or blur stops scrolling; if output changes, finish
  the selection before scrolling further. Pixel mouse is unsupported.
- Paste clipboard images to upload to the Herdr host and insert their paths,
  including through `--ssh-host`.
- Every composer that attaches files (the phone Composer, Spaces, the Town peek
  and Inspector Chat) shows a chip per file: uploading with byte progress, then
  done or failed. A failed file can be retried, by **Retry** or by picking it
  again, or removed. Send waits until uploads finish, and picking a file again
  while it uploads does not upload it twice. A path that finishes after its
  composer closed joins the draft when that composer opens again.
- Drag a file or directory path from the File Explorer into a terminal to
  insert its quoted host path. Terminal font size is adjustable independently
  of interface scale in **Menu → Appearance**.
- Show Herdr session popup panes over the active workspace when a plugin opens
  a modal interaction.
- Relay terminal OSC 52 clipboard writes. Herdr 0.9.0 follows the foreground
  recipient, not proven originating-pane ownership; see
  [clipboard compatibility](docs/DEPLOYMENT.md#herdr-compatibility).
- `Cmd/Ctrl`-click HTTP(S) links to open safely in a new tab, or workspace-relative
  / absolute paths to preview text, Markdown, or images. Wrapped paths remain
  one link, including indented continuations in agent output. Windows drive and
  backslash paths are recognized too. On Herdr 0.9.1, wrapped terminal links
  resolve against visible rows; OSC 8 links retain their explicit destinations.
  Older Herdr versions keep local URL/path detection.
- On a touch screen, long-press a link or path and choose **Open link** or
  **File actions**. This works in every view's terminals, while an agent keeps
  repainting its status line and while the Composer is open. A URL found in the
  text stays offered while its row shows the same text; a labelled OSC 8 link
  is withdrawn when a new frame arrives.

## Workspace Inspector

Open Files, Changes, or Chat with the TabBar Inspector button,
`Cmd+Shift+B` on macOS, or workspace/agent context menus. The header identifies repository,
branch/worktree, and checkout path. Inspector and Annotations leave the primary
sidebar's visibility unchanged. Workspace rows show the latest PR/MR status while
keeping workspace names visible; Inspector commit navigation preserves focus and
refreshes Files after changes.

- Activating a desktop terminal preserves a docked Inspector. After prefilling
  review feedback, **Go to agent** closes it and reveals the destination terminal;
  mobile or expanded Inspectors also close on terminal activation.
- Dock right/bottom, resize, or expand without unmounting the terminal. Header
  controls restore/close; Esc dismisses transient UI, not the Inspector.
- Tab switches keep it open. Workspace switches restore the target checkout's
  view, selection, and layout. Closing returns to the originating tab if it
  exists, otherwise the active tab.
- Wide layouts show navigation beside content; narrow layouts drill into files
  with overlay/full-screen views. Resize the separator by dragging or
  Left/Right/Home/End; double-click resets it. Files and Changes save separate
  checkout-scoped widths.
- Agent browsing starts at its cwd only inside the checkout. Terminal links use
  their pane's workspace, not later focus. Changes cover the checkout, not
  proven agent ownership.
- Open closed worktrees before browsing. Missing/prunable worktrees offer cleanup,
  never sibling files. Removal clears only that checkout's resource state.
- Directory targets opened from terminal links offer a New workspace action that
  prefills the name (last directory component) and CWD, unless the directory
  already backs an open workspace.

Preview is read-only: no synthetic terminal tabs or cross-worktree merged changes.
See [resource ownership](docs/ARCHITECTURE.md#workspace-resource-ownership).

## Agent Awareness and Session Inspection

- See Herdr-recognized identity and working/blocked/done/idle status in the tree,
  pane switcher, command menu, and Agent panel. Focus panes there or through
  browser completion notifications.
- Read and reply to an agent in the Inspector's **Chat** tab, which replaces
  History. Chat reads the conversation from the agent's transcript, never the
  terminal, and hides context the harness injects as user turns. It sends with
  Herdr's agent prompt only to a session Herdr ties to the pane (a reported
  session or a Codex title thread), not to one World guessed from the folder.
  The paperclip attaches files, which upload to the pane's host and add their
  paths to the message.
  A sent message shows as not yet seen until its session's transcript has
  the same words, and then as matched by its words, never as delivered.
  When there is evidence it went to another session, a red notice names both
  sessions and pauses Send until dismissed; when Chat can no longer check, it
  says so, or that it cannot tell when the same words appeared at about the
  same time. Slash commands, and Claude Code's `!` and `#`, go through the
  Terminal.
  A Now bar shows the agent's status, its current task from the terminal title
  and how long it has been at it, with Stop (or Esc twice) for Claude Code,
  Codex and Pi; the step running now shows with its command and timer.
  When the agent waits on a permission prompt, a question (one or several,
  with each choice's description) or plan approval, Chat shows it as an ask
  card and answers with the option you pick (click or its number key), after
  checking the question has not changed.
  Each tool call's row in Chat carries its evidence: a plain label, its state
  and time, a pass or fail badge for a test run, and when opened, the edit's
  diff, the test strip with its first failure, or the end of its output.
  It refreshes when the service sees the transcript, title or status change,
  without browser polling, and keeps the last good view if a read fails. When
  it cannot read the conversation it shows the reason with the matching action:
  copy the integration command, link a Codex session, **Refresh** or **Open
  Terminal**. **Details** opens the History view below. See [Chat](docs/CHAT.md).
- Above the conversation, Chat shows the agent's quest in a foldable log: its
  title, a progress bar and each objective as pending, active, done or blocked,
  read without a model from the harness's own todos (Claude Code `TodoWrite` and
  tasks, Codex `update_plan`, Kimi `SetTodoList`), approved plan, Codex goal or
  `/loop`. See [Quests](docs/CHAT.md#quests).
- In Details, switch between **Chat** and **Timeline**. Chat pairs tool calls
  with results and shares Ranger's conversation minimap; Timeline keeps individual
  records available. Use **Link Codex session** to preview a full conversation UUID
  and confirm its association with the foreground Codex pane. This replaces the
  existing link for all viewers. Codex lookup searches active and archived records
  on the selected local/Unix SSH runtime; Windows SSH history remains unavailable.
  For shared-daemon Codex panes without a session report or thread title, one
  matching pane and one loaded thread can provide a recent, read-only guess.
  Ambiguity shows no conversation. Add **Thread ID** with `/title`, link the
  session explicitly, or use the Terminal to reply or answer permissions.
- Open Details with independent User/Agent/Tool filters (User/Agent enabled,
  Tool hidden initially), a message minimap, and on-demand tool details. The recent window
  counts 200 conversation entries, not associated tools; exports remain complete.
  See [History synchronization](docs/HISTORY.md).
- Choose **Agents: Separate** at the bottom of Workspaces for a dedicated panel,
  keep agents nested, or pick **Agents: Compact** to hide agent rows and always
  show each workspace/worktree tab count instead. Separate defaults to
  **Attention first**: blocked,
  done, working, idle, unknown. Sort/Group icons offer workspace/manual order
  and status/workspace/type groups with collapse controls. Ungrouped manual
  order supports dragging. Sort/group preferences are browser-local; manual
  order is per connection. Idle agents sort by newest session-file activity
  reported by the bridge, with Herdr state-change sequence as a fallback.
  Recency survives refreshes and completion acknowledgements without browser
  activity tracking; manual and workspace order stay unchanged.
- Rows show tab names before pane IDs; blank or numbered defaults (`2`, `Tab 2`)
  are omitted in both views.
- Inspect turns, tokens, update time, session ID/file, and other metadata. Session
  Inspector offers Timeline, searchable ATIF/raw transcripts, and original-file
  or normalized ATIF export.

Readers exist for **Codex, Claude, Kimi, Grok Build, Pi, Muse Code, Antigravity CLI**; Codex,
Claude and Pi are checked against real transcripts (see the [harness matrix](docs/CHAT.md#harness-matrix)). Missing Herdr integration metadata shows the integration command.
Codex 0.157 and later run conversations in a shared background service, so
Herdr's hook cannot say which pane shows which one. Run `/title` in Codex and
add Thread ID: History then reads the conversation from the pane's title, and
shows nothing rather than guess when the title does not identify exactly one.
With `--ssh-host`, Herdr-reported paths and Pi and Codex ID lookups read remotely. Other
ID/directory fallbacks (including Grok Build and Antigravity CLI discovery) remain local and need
locally accessible transcripts.

## Git Worktree Lifecycle

- Create a linked worktree from freshly fetched `origin/main` without changing
  the source branch or dirty files; discover/open existing worktrees.
- See checkout paths, open/closed state, branch status, and uncommitted counts.
- Focus open worktrees, run `git pull`, or enable per-checkout branch updates.
- Remove linked worktrees with confirmation, hooks, process cleanup, and recovery
  that preserves residual files when safe removal fails.

Open **Worktree Lifecycle** from a workspace context menu or search
`worktree lifecycle` in the command menu.

### Paseo Worktree Hooks

Define [Paseo hooks](https://paseo.sh/docs/worktrees) under `worktree` in the
repository's `paseo.json`:

```json
{
  "worktree": {
    "setup": "bun install",
    "opened": "./scripts/worktree-opened.sh",
    "teardown": "./scripts/worktree-teardown.sh",
    "removed": "./scripts/worktree-removed.sh"
  }
}
```

| Paseo hook | When Herdr World runs it | Working directory |
| --- | --- | --- |
| `setup` | After a new linked worktree has been created and opened | New worktree |
| `opened` | After an existing linked worktree has been opened | Opened worktree |
| `teardown` | Before a linked worktree is removed | Worktree being removed |
| `removed` | After removal finishes | Source checkout |

For `setup`, `opened`, and `teardown`, the target checkout's `paseo.json` wins;
only an absent file falls back to the source checkout. After removal, `removed`
normally uses the source configuration because the target no longer exists.

Commands run through `sh -c`. The following variables are available:

| Variable | Value |
| --- | --- |
| `PASEO_HOOK` | `setup`, `opened`, `teardown`, or `removed` |
| `PASEO_CHECKOUT_PATH` | Target worktree path, including the former path for `removed` |
| `PASEO_SOURCE_CHECKOUT_PATH` | Parent/source checkout path when known |
| `HERDR_WORLD_HOOK_EVENT` | `worktree.created`, `worktree.opened`, `worktree.before_remove`, or `worktree.removed` |
| `HERDR_WORLD_HOOK_CHECKOUT_PATH` | Same target path exposed under a `HERDR_WORLD_`-prefixed alias |
| `HERDR_WORLD_HOOK_SOURCE_CHECKOUT_PATH` | Same source path exposed under a `HERDR_WORLD_`-prefixed alias |

Notices show hook outcomes and bounded diagnostics (exit code, stderr, or error).
Failed `teardown` stops removal: fix/disable the hook before retrying. Other hooks
are not transactional: failed `setup`/`opened` does not undo creation/opening;
failed `removed` cannot restore a worktree.

Hooks default to enabled. Disable them per repository in **Worktree hooks** or
**Worktree Lifecycle**, which also show detected configuration and commands.
With `--ssh-host`, configuration and execution are remote. **Hooks are trusted,
unsandboxed code:** review `paseo.json` before creating, opening, or removing.

### Automatic Branch Updates

Fetch `origin/main` and merge into enabled checkouts' current branches every
10 minutes by default. The UI shows interval and last result. Manage saved
per-checkout settings in **Menu → Automatic branch updates**, workspace context
menus, or Worktree Lifecycle.

Runs skip dirty or detached checkouts, verify branch/HEAD/worktree stayed unchanged
during fetch, and abort conflicting merges. Updates run only while the workspace
is open in the current connection.

## File Explorer and Preview

- Browse a cached, expandable tree, optionally including hidden files. Search
  loaded names/paths by substring or glob: `r*md`, `?.txt`, `[abc]*`, `{md,mmd}`,
  and `**` are supported. Patterns with `/` match loaded paths; matching is
  case-insensitive. Git badges mark changed files/directories; ignored files
  are dimmed.
- Choose **Browse filesystem** in the toolbar to opt into read-only browsing
  outside the workspace on the connected host. Use **Parent directory** or enter
  an absolute directory to preview references, copy paths, or download files.
  **Workspace only** restores the tree. This mode is off by default and resets
  on browser refresh or checkout/connection changes.
- Preview text with line numbers, syntax highlighting, and `Cmd/Ctrl+F` search.
  Use **Refresh preview** beside Copy to reload the current file from disk
  without reopening it; the selected Raw/Rendered mode is preserved.
  Markdown offers Raw/Rendered views with Mermaid diagrams in code fences.
  `.mmd`/`.mermaid` files offer Diagram/Source views and accept leading comments,
  document headers, and Mermaid fences. Diagrams have independent zoom, Fit, and
  100% controls; scroll to pan or use Ctrl/Cmd + wheel to zoom.
- Follow Markdown file links within the Inspector: relative to the document,
  leading `/` from workspace root, and heading fragments within the destination.
  For absolute reference files, links resolve from the file directory and
  leading `/` resolves from the filesystem root.
  External links open a new browser tab.
- Preview SVG, PNG/APNG, JPEG, GIF, WebP, BMP, ICO, and AVIF images with zoom and
  Fit controls, plus PDFs and workspace-local Markdown images. Unsupported
  binaries remain download-only; image decoding depends on the browser.
- Drag uploads onto the root/directory. Download files or workspace-scoped
  `.tar.gz` directories; copy absolute paths; delete with confirmation.
  Open actions by right-click or touch long-press.

File operations and previews work locally and over SSH.

## Review Annotations

- Open **Annotations** independently next to **Inspector** in the workspace bar (or
  the narrow-screen view switcher). The panel stays available when Inspector is
  closed and opening it does not change Inspector's view. The tab shows the
  current checkout's comment count, including saved drafts. Use the tab or
  Annotations shortcut to toggle the panel, or its close button to dismiss it.
- Desktop annotations float over the workspace by default.
  **Pin annotations** switches to a fixed layout beside or below the workspace;
  **Float annotations** restores the overlay. The choice stays in this browser.
  Mobile uses an explicit Annotations surface with touch controls.
- Click/drag diff line numbers or source annotation gutters to comment on lines;
  release opens the editor with file, range, and content snapshot.
- Select rendered Markdown passages to capture their text and nearest heading.
- Select terminal text with the mouse, then choose **Add comment** to capture
  the passage and pane label, even with the Inspector closed. Terminal quotes
  have no buffer coordinates and are not re-anchored; missing panes are marked
  unavailable.
- Edit, delete, or reorder mixed checkout-scoped comments. Copy compiled feedback or
  pre-fill a selected Agent pane; **delivery never submits**. Review and press
  Enter manually. After pre-fill, **Go to agent** opens the destination pane/tab.
- Copy retains the browser-local draft. Successful pre-fill removes only unchanged,
  delivered comments; edits made during delivery and failed deliveries retain work.
  Leaving the draft's workspace or connection during pre-fill retains the original draft,
  even after returning. Closing Inspector or Annotations does not discard drafts.
  Blank comments cannot be delivered.
- Refresh re-anchors matching file/diff content and marks unresolved anchors stale
  without losing captured quotes.

## Diff Viewer

- Browse a directory tree with staged, unstaged, untracked, conflicted, and
  branch-diff badges plus added/deleted counts.
- Choose **Working tree**, **Against branch**, or **Last step** (latest completed
  agent-activity snapshot, including commits/untracked files; not proof of ownership).
  Branch mode uses the repository's recorded default, then its configured default,
  main or master. Select a local or remote-tracking branch already present on the
  host; inspection never fetches. The choice is saved per repository and host.
- Read files in repository order. Large, truncated, and `linguist-generated=true`
  diffs start collapsed and render on expansion.
- Choose desktop side-by-side/unified views; mobile is unified. Wrapping saves
  independently for desktop/mobile. Search with `Cmd/Ctrl+F`, Enter/Shift+Enter,
  or previous/next controls. Text is syntax-highlighted; images have previews.
- Jump to File Explorer from a diff. Working-tree context menus (right-click,
  long-press, or keyboard menu key) offer open, copy relative/absolute path, and
  status-matched stage, unstage, mark resolved, discard unstaged, or delete
  untracked actions, with destructive-action confirmation.
- **More Git actions** (`…`, beside Refresh) offers Stage All, Unstage All,
  Discard All Unstaged, and Delete All Untracked with affected-file counts.

Scope, view mode, wrapping, and recent selection persist per checkout/browser.
Git actions recheck status/content and reject stale menus instead of destroying
newer work.

## Mobile and PWA

The Message editor sits below each terminal in normal layout flow. Tap it to
raise the keyboard and compose; Direct explicitly enables raw terminal input.
Tabs and More stay in World's shared top app bar. If an upload finishes after its
Direct destination retires, World keeps the path in the original Message draft
and reports the failed insertion instead of sending it to another pane.

- Responsive terminals, Inspector, and viewport/keyboard handling. **Menu →
  Appearance → Layout → Display mode** offers Automatic/Mobile/Desktop.
  Automatic uses **Mobile up to (px)**: 768 by default, adjustable 320–2560 CSS
  pixels. Mobile stays mobile at any width, including after reload.
- URL overrides `?layout=mobile`, `?layout=desktop`, or `?layout=auto` beat saved
  mode. Choosing a menu mode clears that override, preserving other parameters.
- Choose **Agents on top** or **Workspaces on top** independently for each layout
  under Layout Preferences. This affects the separate Agents panel; mobile defaults
  to agents first, desktop to workspaces first.
- Touch taps and swipes read terminal output without opening the device keyboard.
  Use the bottom-right **Open device keyboard** button to type directly; a light
  touch tap on the terminal dismisses it without sending input. Scrolling keeps
  input active. Mouse selection and physical-keyboard input work in either layout.
- Long-press a word directly in the terminal, drag either selection handle, then
  **Copy** or **Add comment**. Copy keeps the selection; **Done** or Escape returns
  to reading without opening the keyboard. Scroll before selecting older output:
  touch handles cover the displayed viewport. Output stays connected and the
  displayed frame freezes until selection ends, then shows pending output.
  Legacy incremental streams resume automatically at a 1 MiB buffered UTF-16
  payload limit without discarding output or a captured comment.
- Configure the floating terminal panel's `2×8` shortcut grid and up to four
  side buttons. Empty editor slots keep their positions but compact at runtime.
  Actions include Ctrl, arrows, Enter variants, full/half-page scrolling, and
  Paste (text or uploaded clipboard-image paths).
- Switch split panes or use the Tabs sheet to create/switch/close tabs when the
  strip is hidden. The composer supports native IME, dictation, multiline text,
  and images: **Insert** does not execute; **Send** adds exactly one Enter.
  Drafts stay in memory per connection/pane; closing their pane/tab/workspace
  asks before discarding them.
- A bundled glyph-only Nerd Font supplies common terminal icons. Install as a
  PWA in iOS/iPadOS Safari, macOS Safari, Chrome, or Edge to remove browser chrome.
  It still needs a reachable Herdr World process, not offline access. Use **Menu →
  Reload page** in the browser or PWA.

Mobile shortcuts and appearance stay in this browser, not Herdr configuration.

## Shortcut cheat sheet

On desktop, open the searchable, read-only overview of your active shortcut preset
with Cmd+Shift+K on macOS or Ctrl+Alt+Shift+K on Windows/Linux, the top-bar command
icon, Actions, or Menu → Shortcut cheat sheet. Numbered actions collapse into 1–9
rows. Customize assignments in Configuration.

New workspace and worktree dialogs suggest readable two-word names. Suggestions
load asynchronously; editing the name takes precedence over a late suggestion.

## Remote, Multi-Client, and Operations

- Manage shared local/SSH profiles with independent browser selection. Disconnect
  does not stop Herdr/workspaces. Linux/macOS `--ssh-host` forwards control and
  render sockets; Windows supports native local profiles, not SSH forwarding.
  See [connection setup](docs/DEPLOYMENT.md#local-and-ssh-connections).
- Remote file/image-paste/Git/hook operations run on the same host; session
  inspection has the metadata limits described above.
- Enable local browser alerts and background Web Push in **Menu → Behavior &
  automation → Task notifications**. See [push setup and troubleshooting](docs/DEPLOYMENT.md#web-push-notifications).
- **Chimes.** While a World page is open, World plays its own chime for a
  change that needs you: a sound for who (the Town master, the crew, or the
  agent's profile) and a pattern for why (needs you: two rising notes;
  for you: a soft double knock; finished: one falling note). A toast always
  says who and why, or "sender unknown" when Herdr didn't say. Changes within
  3 seconds share one chime and one "N changes" toast. **Menu → Sounds** sets
  this device's chimes and volume (per device), the Town master's and crew's
  sounds and which patterns play (all your browsers), and who the Town master
  is: only you assign it, and its needs-you chime still plays while you focus
  on other agents. A profile's **Look & sound** gives its agents their own
  chime. An agent sends you a "for you" with `herdr notification show <title>`
  and no `--sound`. While World chimes, its notifications are silent; Herdr's
  own client may still play its sound (`[ui.sound] enabled = false` turns it
  off).
  Muting this device also silences push while World is open, including just
  after enabling notifications. Changes to device settings apply across open
  tabs, and queued burst sounds obey your current sound settings.
  Missing sender metadata stays unknown and uses the crew sound.
- Multiple browsers receive pushed events. Pause/resume yours, see client counts,
  or pause others. Herdr semantic task alerts use the relevant pane when Herdr
  supplies one; pane-less alerts open World without guessing a target. Older
  Herdr runtimes use agent-status completion alerts.
- Choose light/dark/system appearance, persistent accents, and terminal themes
  per appearance mode in **Menu → Appearance → Terminal theme**. Built-ins
  include Solarized, Dracula, One Dark, Nord, Tokyo Night, Catppuccin, and GitHub;
  custom themes set base/ANSI colors. Themes apply live to all terminals and save
  per browser. **Text size** scales the UI from 80% to 150%, including mobile.
- Manage a user service from the CLI; check releases and run checksum-verified
  one-click standalone updates under a supported supervisor. Probe `/health` or
  `/healthz`. See [services](docs/DEPLOYMENT.md#user-service).
- Keep Herdr on the version this World release verified: installs and updates
  bring Herdr, the Codex/Claude/Pi harness integrations and the Herdr World plugin up to
  date, and **Menu → Runtime → Upgrade Herdr** (or **Update Herdr integrations**)
  appears when something is behind. A running server keeps its panes through a
  live handoff when World can prove nothing supervises it (Linux); otherwise World says a restart is
  needed. See
  [Herdr installation and upgrades](docs/DEPLOYMENT.md#herdr-installation-and-upgrades).

**All listeners require login**, including loopback. World generates a persistent
token unless an 8–1024-character password is configured; 15+ characters are
recommended beyond a trusted private network. Failed logins receive a bounded cooldown. Configure [native HTTPS](docs/DEPLOYMENT.md#native-https)
or an authenticated HTTPS proxy for encrypted access. World supplies no multi-user authorization or sandboxing; read [SECURITY.md](./SECURITY.md).

## Keyboard Shortcuts

Open **Menu → Behavior & automation → Keyboard shortcuts** for the searchable
list and preset editor on desktop/mobile. Lists and hints show active bindings.
See the [desktop](docs/screenshots/keyboard-shortcuts-desktop.png) and
[mobile](docs/screenshots/keyboard-shortcuts-mobile.png) editors.

- **Automatic** detects macOS/iOS, Windows, or Linux/Android; explicit presets
  override detection.
- **Edit** records/types up to three alternatives, restores defaults, or unassigns
  an action. Editing built-ins creates a custom copy. Overlapping conflicts are
  rejected while ordinary typing, IME, and dialog dismissal stay available.
- **Save as** creates named presets; **Active preset** switches them. Edits save
  immediately and sync to same-origin tabs. **Export/Import** transfers JSON
  between browsers; deleting a custom preset returns to Automatic.
- Letter/number bindings use physical keys, unaffected by modifier-produced
  characters. Recording captures only keys the page receives; choose alternatives
  for browser/OS-reserved shortcuts, including macOS tab shortcuts.

Common defaults (Linux/Android overrides follow the table):

| Action | macOS / iOS | Windows / Linux / Android |
| --- | --- | --- |
| Command menu | `Cmd+K` | `Ctrl+Alt+K` |
| Sidebar | `Cmd+B` | `Ctrl+Alt+B` |
| Workspace Inspector | `Cmd+Shift+B` | `Ctrl+Alt+Shift+B` |
| Expand / restore Inspector (desktop) | `Cmd+Option+Enter` | `Ctrl+Alt+Shift+Enter` |
| Annotations | `Cmd+Option+A` | `Ctrl+Alt+A` |
| Zen mode | `Cmd+Shift+Z` | `Ctrl+Alt+Z` |
| Recent pane switcher | `Ctrl+Tab` | `Ctrl+Alt+J` |
| Pane Search | `Alt+K` | `Alt+K` |
| Create / close tab or pane | `Cmd+T` / `Cmd+W` | `Ctrl+Alt+T` / `Ctrl+Alt+W` |
| Previous / next tab | `Cmd+Option+Left/Right` | `Alt+Shift+Left/Right` |
| Focus neighboring pane | `Cmd+Ctrl+Arrow` | `Ctrl+Shift+Arrow` |
| Split right / down | `Cmd+D` / `Cmd+Shift+D` | `Ctrl+Alt+D` / `Ctrl+Alt+Shift+D` |
| Zoom / restore pane | `Cmd+Shift+Enter` | `Ctrl+Alt+Enter` |
| Arrange Single / Cascade / Columns / Rows / Grid / Restore | Unassigned; use Actions or set custom keys | Unassigned; use Actions or set custom keys |
| Numbered tab | `Ctrl+1…9` | `Ctrl+Alt+1…9` |
| Numbered command menu action | `Option+1…9` | `Alt+1…9` |
| Workspaces | `Ctrl+Shift+W` | `Ctrl+Alt+O` |
| File Explorer | `Cmd+Shift+E` | `Ctrl+Alt+E` |
| Diff Viewer | `Ctrl+Shift+G` | `Ctrl+Alt+G` |
| Agent chat | `Cmd+Shift+H` | `Ctrl+Alt+H` |
| Search raw preview / diff | `Cmd+F` | `Ctrl+F` |
| Send composer / add review comment | `Cmd+Enter` | `Ctrl+Enter` |
| Copy terminal selection | `Cmd+C` | `Ctrl+Shift+C` / `Ctrl+Insert` |
| Terminal paste | `Cmd+V` | `Ctrl+V` (also `Ctrl+Shift+V` on Linux) |
| Open terminal links / file paths | `Cmd+Click` | `Ctrl+Click` |

Linux/Android uses `Ctrl+Alt+Shift+T` to create tabs, `Ctrl+Alt+Shift+D` to
split right, and `Ctrl+Alt+Shift+S` to split down, avoiding common Linux desktop
shortcuts for launching a terminal or showing the desktop.

Terminal copy, page/half-page navigation, and modified Enter are configurable
here. Copy needs a selection; plain `Ctrl+C` remains terminal input. Native text
editing, editor search, and shell/agent keys follow those apps. Native clipboard
gestures remain; remapped paste needs the browser Clipboard API. Touch controls
use the separate **Mobile terminal shortcuts** editor.

Esc dismisses dialogs, menus, notifications, and update banners. Tab/arrows
navigate controls. The pane switcher accepts Up/Down, Enter, or release of its
opening modifier. Diff search uses Enter/Shift+Enter for next/previous. Select in
mouse-aware apps with Option-drag (macOS) or Shift-drag (elsewhere).

## Ranger and workspace tools

- Ranger reads explicitly permitted workspaces across local and SSH connections,
  chats with a configured model, and proposes actions for manual confirmation.
  An explicit high-permission mode can execute supported operations automatically.
- While Ranger answers, **Steer** or Enter adds a message after its current step;
  **Queue** or Alt+Enter (Option+Enter on macOS) waits for the next answer. Up to
  eight waiting messages can be edited or removed. Stop, failure or a chat switch
  holds them until **Send next**. A replaced runtime requires a refreshed scope.
- When the model provides reasoning, a collapsible **Thinking** section shows it
  above its reply. Selecting Ranger text is preserved while terminals repaint.
- Background tasks run once, at intervals or daily, with separate conversations
  and optional monitoring alerts. Saved schedules retain endpoint and workspace
  identity; interactive requests capture their runtime generation.
- Inspect Git commit history, keep file-preview tabs, pin and reorder native tabs,
  and move or swap panes within their owning connection.
- Configure terminal fonts and direct/composer input, upload files to the captured
  host, and set a distinct browser instance title.
- Login is required on localhost and other listeners, using a generated token or
  a configured 15–1024-character password, with throttling for failed attempts.

## Latest upstream additions

- Ranger workspace/agent mentions, quick model and thinking controls, task-management
  previews, guarded close actions, and clearer settings/chat history.
- Windows Herdr 0.9.1+ hosts over SSH from Linux/macOS World, with native terminal
  and workspace actions. Unix-only remote file and Git tools remain unavailable.
- Optional private-network PIN login with independent session signing and recovery.
