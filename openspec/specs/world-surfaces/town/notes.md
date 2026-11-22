# Town notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Town in the view picker or open /town; use buildings, room cards and desks.
- Reception, board sign/Summary, room/table popovers and the town center ring are entry points.
- Settings exposes lenses, calm motion and reception preferences; phones retain semantic targets.
- TUI and core share Town; core pins derive from herdr.pinned, TUI pins from World settings.

**Code:**

- `web/src/world/town/`
- `web/src/world/useDeskPins.ts`
- `web/src/world/town/townLens.ts`
- `web/src/world/town/townLens.test.ts`
- `web/src/world/town/townReceptionFilter.ts`
- `web/src/world/usage/UsageLens.tsx`
- `web/src/world/usage/usageModel.ts`
- `web/src/world/usage/UsageBreakdown.tsx`
- `web/src/world/town/TownObservatory.tsx`
- `web/src/world/usage/usageModel.test.ts`
- `web/src/world/usage/UsageScreens.dom.test.ts`
- `web/src/world/town/townObservatory.test.ts`
- `web/src/world/usage/UsageLens.browser.tsx`
- `web/src/world/TownView.tsx`
- `web/src/world/town/TownCanvas.tsx`
- `web/src/world/town/townLayout.ts`
- `server/src/world/observability.ts`

**Tests:**

- `web/src/world/town/TownCanvas.test.ts`
- `web/src/world/town/TownCanvas.fold.test.ts`
- `web/src/world/town/townLayout.test.ts`
- `web/src/world/town/townReceptionFilter.test.ts`

**Pitfalls:**

- Each runtime connection keeps its own building and qualified room actions.
- Room counts cover all observed agents; drawn desks are a native-order prefix.
- Pins and selection do not pull hidden desks across the fold boundary.
- Moving rooms on the canvas is separate from moving native desks; see town-moves.
- CLI desk pins/moves use their feature contracts, not canvas coordinates.

## Usage reference

- **Town** is the default view (`/town`); the root URL opens it too.
  Each host is a building, each workspace a room, each tab a team table and each
  pane a seat. Rooms resize as tabs open and close; expanded rooms stay expanded
  as they shrink, until folded. Plain terminals show prompts. Additional panes beyond the drawn
  seats remain available through the table's count and chooser. Each table's
  nameplate shows its sole agent's Herdr name when exactly one named agent
  occupies the tab; otherwise it shows the tab's name, or `Tab N` if unnamed.
  Agents go by the name Herdr gives them (`firstmate`), else their harness
  (`claude`); window and Inspector titles put the name first
  (`firstmate · claude`).
  - One machine is one building: this computer's Herdr TUI and herdr-core
    rooms stand together under one sign, each room's nameplate naming its
    runtime (**Herdr TUI** or **herdr-core**) and keeping its own controls,
    and every desk, agent and action stays on its own runtime's connection.
    **Settings → Town & views → Town buildings → One per runtime** gives each
    runtime its own building again (**One per machine** is the default).
    Two Herdr TUI connections to the same socket (the startup default and a
    saved profile) show its rooms once, through the writable one.
  - The Town board counts the whole town, every building, in four one-word
    columns: **Busy** (working) agents, **Waiting** (items needing
    you: blocked agents and open questions, matching the reception tray and
    **Needs you**; a blocked agent with an open question contributes two
    items), **Done** (finished) and **Quiet** agents. A line under the counts
    gives every agent in the town and its buildings (and any of unknown
    status). It shows spend when a metrics provider
    is configured. Under **FUEL**, a gauge per harness with subscription-limit
    data (Codex from its session logs, Claude from its status line) shows a short bar per window
    (`5 h`, `week`) with the percent left; under 15 % left it turns amber and
    says **low**. A reading more than 15 minutes old shows its age under the
    bars in muted text, such as "seen 20 min ago"; past 30 minutes its levels
    dim and the age reads "as of 09:24", and a dimmed reading never turns the
    compact chip **low** on its own. A window the source did not send reads,
    for example, `5 h — not reported` instead of vanishing, and a harness with
    agents in Town but no reading from any host reads `Codex — no reading yet`
    in muted text. Hover, focus or tap a gauge for each reset time, how long
    ago the numbers were seen, their source and one line on what refreshes
    them. Old numbers (over 3 h, or past a reset) read **stale** with no level;
    with several hosts the board shows a current reading before a dimmed one,
    and among those the one with the least left. The summary window's hosts and
    Board's facts show each host's reading with the same rules, and name a
    harness with agents on that host but no reading from it.
    Claude gets its own gauge within about a minute of the first answer from an
    agent started from World's launcher: its status line passes Claude Code's 5 h and week windows to
    World, and the agent's status line looks as before. World shows Claude Code's
    own figure, which can trail claude.ai by about a point. Concurrent tap
    writers keep the highest comparable reading until reset, even if one pauses
    before publication. Only confirmed process death permits lock recovery;
    contention or unknown liveness skips a reading after about half a second
    and still runs the user's status command. When Claude refused
    work at its limit, the gauge reads **reached, resets …** instead of a level.
    Every row stays inside the board at its desktop, phone and Board widths: a
    longer value takes room from its bar, **reached, resets …** wraps, and a
    long caveat line under the economy figures ends in an ellipsis (hover or tap
    it for the full text).
    Chat and quests refresh usage stops after local transcript rewrites, including
    same-size writes whose file timestamps stay unchanged.
    The board stays folded into a compact status chip at the top left: one
    icon, **!N** in amber while N items need you, and the lowest fuel percent
    (or **reached**) only when a gauge is low or reached. Hover the chip with a
    mouse, or tap, click or focus and press Enter, to open the board below it as
    a popover. A click or tap keeps it open; Escape, a tap outside or another
    tap on the chip closes it. Opened by hover alone, it closes shortly after
    the mouse leaves the chip and board. The board's **Summary** button
    opens the **Town summary** window: blocked agents and
    questions you can answer in place,
    unreviewed finishes and when each was last active, every host and room
    with its counts (tap a room to go there) and its subscription limits
    (each window's percent used, reset time, source and age; stale or missing
    labelled; a Claude refusal reads "limit reached"), and spend per model ("No cost
    data" without a provider). Press **Summary** again to restore its minimized
    window or bring it to the front.
  - **Since you left**: after 30 minutes or more away (no visible World tab
    with input, on any device using this World service), the Town board sign
    starts with "Since 11:40 · away 3 h ✕" and up to four lines, most
    important first: new questions and newly blocked agents ("2 new for
    you"), who asked ("1 new question from builder"), finished work still to
    review ("5 finished"), and, with the GitHub source configured, pull
    requests merged meanwhile. Each line opens **Needs you** at its first item
    (the merged line, which names no item there, opens **Needs you** itself),
    where everything that arrived while you were away has a small "new" dot
    until you click or type in it. The recap only counts what still waits, so
    answering and reviewing shrink it; **✕** clears its lines on this browser
    without touching any item, until your next return. A phone shows it as one
    line under the summary chip ("Since 11:40: 2 for you, 5 finished ›"),
    which opens **Needs you**. Calm motion shows it without animation. The
    service remembers your last sighting in memory; after a service restart,
    each browser's own last sighting decides.
  - **Tab and app icon count**: in every view, while anything needs you, the
    browser tab reads `(N) Herdr World`, its icon carries a small yellow
    badge (the number up to 9, then `9+`), and an installed World shows the
    number on its dock, taskbar or home-screen icon where the system supports
    app badges. N is the **Needs you** count. It keeps updating while the tab
    is in the background and follows answers made on another device; with
    nothing waiting the title and icon are plain again. Switch off
    **Menu → Settings → Count on tab and app icon** to stop it on this browser.
  - Each building has its reception at the top, under the front door, and a
    bar in its bottom corner. Blocked agents queue at reception oldest first.
    A queued agent without a Herdr name is labelled with its room rather than
    its harness, and its tooltip adds the desk, so the board says where each
    one waits from.
    A closed reception is a small marquee over the door, so hundreds of
    agents never bury the town under boards: the building's name, how many
    need you and the first five faces waiting (amber waiting, green done),
    with `+N` for the rest. Hover it, Tab to it, or tap it or its lobby, and
    the full board opens over it with every name, the sign, Tidy rooms and
    the expenses; it closes when the pointer or focus leaves.
    Finished agents wait there until you open their terminal or mark that
    completion reviewed, then join idle agents at the bar. Movement only
    represents state.
  - Each reception's sign shows the marks it takes: **!** Needs you, **?** Asks
    you and **✓** Done, with the ones it leaves out greyed. Press the sign to
    choose them for that building, or tick **Apply to all buildings** to give
    every building the same marks; **Reset to default** (all three) resets
    that building, or every building while **Apply to all buildings** is
    ticked. An agent whose mark its reception
    leaves out stays seated at its own desk with that mark overhead; it never
    walks to reception, the bar or anywhere else. Reception then shows a tag
    such as `✓ 4 at desks · find`: **find** opens the first of them and the
    card's **Next ›** steps through the rest. The filter moves bodies, not
    facts: marks, the Town board, room plaques, Board, Desk and Needs you
    count and list every agent as before. World saves the filter, so every
    browser and device shows the same one. Zoomed in to desks, where the
    reception boards are put away, tap a building's reception lobby to bring
    its board and sign back; any other tap or zoom level puts it away again.
  - Town shows what the crew spends. The **City expenses** billboard stands
    on the lawn above the town center, never over it: the whole World's tokens
    and estimated cost, such as "Today · 1.2M tokens · $3.40 est.", with a
    **Today** / **7 days** toggle. Each building's reception board ends with
    its **Expenses today**: the host's tokens and cost and its three
    costliest rooms. The Town board's **Economy today · UTC · harness logs**
    shows the same Today total and price-table estimate as the city board.
    Both windows share one read, and seven days includes today. Building totals
    add up to the city; unattributed usage is already included. Detail limits
    leave totals intact and are labelled. Figures come from [harness usage](../../../../docs/usage.md). The
    boards never show a missing number as zero: without a price table they
    show tokens and say "no price table" (or "some models unpriced"); a host
    whose harness logs cannot be read says "no data"; a quiet host says
    "none recorded". Each figure has at most one short caveat line, such as
    "partial · stale left out · 1 host missing"; hovering it, or tapping it on
    a phone, explains each caveat in full, including usage tied to no pane or
    room ("unattributed", already in the totals) and a limited detail list. The boards re-read usage about once a minute and when the page
    regains focus; when re-reads fail, the last figures stay for at most five
    minutes and never past UTC midnight, then the boards read "out of date". On a phone the billboard stands above the town center as
    on a wide screen; each reception's expenses fold to a sign in its title
    (a phone keeps only a few rows of yard above each building for its
    reception board); tap one to open it. Zoomed in to desks, the boards are put away with
    reception. At every zoom the reception boards keep clear of the town
    center, the post office, the warehouse, the observatory, the billboard and each other: a
    board that would cover one slides aside the least it can while staying
    over its building, else it hangs lower, below the center or the board in its way.
    The `?scene=town-scale` preview replaces every economy reader with labelled
    test data for its synthetic buildings, including the Town board and Spend lens.
  - Town's **post office** stands on the first street left of the town
    center, on a phone as on a wide screen: Town's place for what is
    addressed to you, messages and never cargo (pull requests are crates in
    the warehouse; releases are ships). Its red sign on the roof counts,
    without hovering, what **Needs you** lists, by kind with the shared
    marks: "? 2 questions", "! 1 blocked", "✓ 3 to review", and "✉ 1 to
    check" for saved answers waiting in the Outbox; with none it reads
    "Nothing for you", and its rim turns gold while a question or a blocked
    agent waits. Click it, or focus it and press Enter, to open the same
    **Needs you** tab as the top bar's counter, where you answer, withdraw
    and reach the Outbox as usual; it is not a second inbox. It counts the
    hosts the Hosts filter shows, as Needs you does. On a phone the sign
    folds to a smaller red plate across the house's front, in view at home
    zoom, with the marks and numbers only; tap it for Needs you. Each open
    question for you (from `herdr-world ask`) is a letter in its yard,
    oldest first; a letter from a caller World could not verify has a grey
    seal. Hover or focus a letter for "Letter from orbit: …"; click or tap
    it for a card with the question, its answer choices, its age and
    **Answer in Needs you**, which opens Needs you at that question.
    Answers on their way to an agent ride the mail trolley by the door, red
    when one needs checking (delivery uncertain or refused); click it to
    open the Outbox. More letters than the yard holds make a "+N" bundle
    that lists the rest. For trying it without real questions, open World
    with `?townPostFixture` (four synthetic letters, one unverified, and
    three answers on the trolley; the sign counts them), `?townPostFixture=many`
    (a bundle) or `?townPostFixture=empty` (no mail); the page drops the
    parameter at once, only the post office uses it, and a test letter's
    card has nothing to answer.
  - Town's **warehouse** stands on the shore at the first street's end, by
    the harbour, its yard on the pavement: your open pull requests (opened by
    you, waiting on your review or assigned to you) as crates in its yard,
    ready to merge first. Its sign counts them without hovering, such as "2
    ready · 1 failing · 3 waiting", adding unknown and draft when there are
    some. A crate's straps and stencil show its state: green ready to merge,
    red CI failing on its head, amber waiting (for CI, a review, a fix or
    GitHub), grey for unknown and loose planks on a pallet for a draft. It
    reads the GitHub source and the pull request card's merge rules, so stale
    or partial detail is unknown, never ready. Hover or focus a crate for
    "#123 title", its repository and its state in words; tap it for the same
    pull request card the desk badge opens (**Details**, **Merge…** and the
    rest). A merged crate is carried off toward the quay for the next release
    (with calm or reduced motion it just goes); a closed one fades. More than
    the yard holds make a "+N" pile that opens the rest as a list. Click the
    warehouse's sign, or **All pull requests** at the top of the pile's list
    or the phone sign's list, to open Board's **Work** lens over Town: every
    pull request in the same columns, with the Tickets tab, each card's
    actions and the same Escape, Back or press-outside close. An agent on a
    card opens as tapping it in Town does. With the GitHub source off, signed
    out or not yet answered, the warehouse is closed and says to connect
    GitHub in **Integrations** (its sign opens them), with no crates and no
    counts; when a refresh fails it keeps the last list as unknown and says
    GitHub is out of date. On a phone it stands on the harbour's shore too,
    and a sign on the town center's right wing, in view at home zoom (a crate
    and "PRs", no counts: the post office counts what needs you), opens the
    crates as a list with their counts. Searching Town for "warehouse" (or
    "pull requests") lists the **Warehouse** and choosing it takes the map
    there, on a phone or a wide screen. For trying it without
    real pull requests, open World with `?townWarehouseFixture` (synthetic
    pull requests in every state; ten seconds later the first ready one
    merges), `?townWarehouseFixture=many` (a pile) or
    `?townWarehouseFixture=off` (signed out); the page drops the parameter at
    once and only the warehouse and the Work lens it opens use it.
  - Town's **observatory** stands on the first street right of the library,
    which stands right of the town center (a wide town grows rightwards to
    keep its lot; nothing moves). Its
    sign shows, for Claude and Codex, the **5 h** and **week** subscription
    windows used and when each resets, such as "40% · Wed 14:00", or
    "limit · 12:40" when the harness refused work; a window with under 15%
    left is orange. A badge beside each name counts its agents at work, and a
    tower window lights per agent at work (warm for Claude, cool for Codex,
    pale for any other harness; "+N" past eight): Town's working agents, or
    the runs that answered in the last ten minutes where those are more. A
    harness with no reading, including one at work whose budget World cannot
    read (such as Cursor), says "no reading", never 0%; an old reading is dimmed "out of date".
    On a phone it folds to a night-blue sign with a telescope on the town
    center's right wing, such as "Claude 71% Codex 18%". Either sign opens
    **Usage**, a lens over Town with four tabs (Escape, Back, the close
    button or a press outside closes it):
    - **Budget**: each harness's windows with a meter, a line where even use
      would be now and the pace in words: "On track to be used by the
      reset", "Runs out around Thu 09:00, 1 d 5 h before it resets",
      "On pace to leave about 40% unused" (under 80% by the reset), "Too
      early in the window to tell" in its first tenth, or "Limit reached".
      Each card says how many are at work and when and where the reading
      was seen.
    - **Runs at once**: per harness, the most runs going at the same moment
      in each hour of the last 24, stacked into building (worker, fixer) and
      reviewing or checking (reviewer, checker), with the week's busiest
      hour and **Show as table** for the same numbers. A run is going while
      its responses are at most ten minutes apart and while World sees its
      agent working; two short runs at 12:05 and 12:30 are one at once.
    - **Tokens**: the runs answering now and the week's heaviest, each with
      role, item, tokens, calls, largest prompt and context fill; tokens by
      role (with the typical run and calls) and by item or pull request. A
      fixer's second or later round on one item, a context 85% full or a
      run with several times its role's typical calls is flagged in words.
      A run of a harness World reads no log of (Cursor, OpenCode and others)
      shows its time at work and waiting, and "tokens and cost not available
      for this harness".
    - **Breakdown**: the last seven days by **Agent**, **Project**, **Room**
      or **Day**, with time at work, time waiting on you, tokens, cost (the
      harness's reported cost, else "est." from list prices) and pull
      requests opened and merged, and a total row. "unknown" means no
      reading; "(partly read)" means some sources were not readable. Agents
      and rooms no longer open read "Earlier agent" and "Earlier room".
      Under the table, **What World can read** names, per harness at work
      this week, whether its tokens come from its session logs or only
      World's time is known, and whether pull requests could be read.
    Every number comes from [usage analytics](../../../../docs/usage-analytics.md):
    each API response counts once, roles are read from a run's first prompt
    (unknown when it names none), and what the logs do not show says
    "unknown" instead of an estimate. A run's pull request comes from a work
    link its own agent session confirmed, never from its branch alone; a
    branch a pull request has but no confirmed link reads "(pull request
    unknown)". The read refreshes at most every 30
    seconds; after five minutes of failed re-reads the sign says "Usage
    unavailable". For trying rare states, open World with `?usageFixture`
    (two harnesses at work), `?usageFixture=reached` (Claude's 5-hour limit
    reached) or `?usageFixture=empty` (nothing observed); the page drops the
    parameter at once, and only the observatory, Usage and agent cards use
    synthetic runs until the next page load.
  - When reception's queue is full, the rest crowd the lobby beside it in the
    same order, grumbling with a `#@!` bubble; after about 90 seconds a
    grumbler naps on the lobby floor with a `z`. A freed queue spot goes to
    the front of the crowd, and the others move up. Under calm motion the
    crowd stands still, still grumbling or napping. The crowd takes turns:
    one `#@!` bubble per lobby at a time, passing every couple of seconds
    (under calm motion one grumbler keeps it). Zoomed out to the room cards,
    bubbles that would stack thin to one per small patch of screen, the most
    urgent there (blocked, then a question, out of fuel, finished, then the
    crowd); zoom in to see each one. An agent whose state is
    unknown sits at its desk scratching its head under a purple `??` instead
    of dozing.
  - An agent that stopped because its harness hit a subscription or usage
    limit is **out of fuel**: it stays slumped at its own desk, head sunk and
    arms hanging, under an empty red fuel can and a small clock with the
    reset time beside it. Zoomed in, that mark stands in front of the room's
    plate and the seat name tags, so neither hides it. It never
    walks to reception, the bar or the call rail, since there is nothing to
    answer. World reads the stop from the harness's own records, never the
    terminal: Codex's rate-limit snapshot (`rate_limit_reached_type`) or its
    usage-limit error in the session log, and Claude Code's usage-limit
    refusal in its transcript. Its table's card says, for example,
    `Usage limit reached · resets 15:00 (Codex)`, or `Usage limit reached
    (Claude)` when the record has no reset time. Room plaques
    (`1 of 4 agents active: 1 working, 0 waiting on you, 3 out of fuel`), the
    Town board and the Summary's hosts and rooms count out-of-fuel agents on
    their own; they are not active. The state clears by itself once the
    reset time passes or the agent works again.
  - Every building has roads on at least three sides: a street above and below
    each row and a side road to its right. A matching road runs down the left
    of each row's first building, so the town is bounded by roads on both
    sides; its crossings have bus stops like every other.
  - A host entering the town (added in **Manage connections** or ticked in
    **Hosts**) arrives: its neighbours, the roads and the camera make room,
    then its building rises out of its lot in a puff of dust, springs a
    little past its height and settles, its reception and plaques appearing
    as it stands. A host leaving (removed or unticked) stretches up, sinks
    into its lot in dust, and the town closes the gap. Each building rises
    or sinks in under a second, and can be used at once. Several hosts at
    once rise or sink one after another, a moment apart. A building that is
    changed, moved or removed while it rises carries on from its height. A
    host that only disconnects keeps its building, and opening or reloading
    Town shows the buildings already there with no arrival. Reduced motion swaps buildings at once, with no
    movement; calm motion raises no dust.
  - The land around the town is generated: woods with pines, meadows, hedged
    flower gardens and orchards, ponds with reeds, winding footpaths, and each
    street running on beyond the town as a country lane. It fills the whole
    view at every zoom and pan: past the town's own land the woods, meadows,
    gardens and ponds carry on as far as the window shows, with no plain border.
    It is the same on every reload and in every browser, and
    when the town grows only the land next to the change is regenerated. It
    keeps clear of buildings, roads, the town center and its paved apron, bus
    stops and the verge above the first street.
  - The **town center** stands at the top of the town, just across the first
    street from the buildings and centred over their first row: a domed hall
    with a clock, a columned portico, banners and wings, whose front steps
    open straight onto the street's pavement. Buildings stand side by side
    below it with only the normal streets between them. Wide windows open
    Town framed on the billboard above the center and the reception boards
    down to the buildings' street, centred, every board whole, with the park
    below off-screen. Phones open Town with
    it at the top and the first building under it; on a short screen the view keeps
    the building's lounge and shows the center from its plaque down. Tapping it, or its **Town center** plaque (Tab to it, then Enter),
    opens a ring of actions around its doors: **New agent** (World's launcher,
    preselecting the open room when it can start one there), **Town master**
    (the role holder from **Settings → Chimes and who plays them**, else the
    agent named in **Settings → Town master** when nobody holds the role, opened on Chat; a holder not in
    Town says so; with neither set it opens **Sounds**),
    **Needs you** with its count, **Summary**, **Lenses**, **Profiles** and
    **New room** (disabled with the reason when no room can be created). With
    no room open, New room asks for the **Destination host**, herdr-core hosts
    included (`· herdr-core`); an empty core room name becomes "Room". Arrow
    keys, Home and End move around the ring; Escape, a press outside, the
    centre **✕** or **Back** on a phone closes it.
  - **Lenses** colour the whole map by one fact, as strategy games' map
    overlays do, so you see at a glance where it is high or low. Turn one on
    from the town center's **Lenses** or with `L` (`Shift+L` steps back); the
    Town board sign (on a phone, the summary chip) becomes the lens's legend:
    its name (press it to choose a lens), **‹ ›** to step, **✕** to leave, the
    scale, and the reading of the place under the pointer, keyboard focus or
    last tap. Town dims; at home and building zoom each room's floor takes its
    room's colour, with the room's name and short reading at building zoom;
    at room and desk zoom each desk and seated agent carries its own.
    **Idle time** runs from under 5 minutes (warm) to 8 hours and more (cold)
    since each agent last worked; a room shows its coldest quarter.
    **Spend** is today's estimated cost per room and desk (by tokens when
    some usage is unpriced), from the same usage as the expenses boards; a
    host or place without a reading is hatched **No data**, never zero.
    **Pull requests** colours desks with a linked pull request as failing,
    ready, waiting, draft or merged, from the same links as the desk badge;
    a room shows its most urgent. **Quests** shows each agent's quest
    progress; **Harness** shows Claude, Codex, Pi, other agents and plain
    shells, and a room or desk with several harnesses is striped by each
    one's share. Desks and agents with nothing to show stay plain. Screen readers
    hear each place's reading in its name. A lens changes only how Town is
    drawn: taps open what they always do, nothing moves, Escape or **✕**
    returns Town exactly as it was, and Town always opens in **Attention**
    (Town as usual). A search with a lens on outlines its matches over the
    lens's colours, and ending it returns to the lens. The browser remembers
    the last lens for `L` and **Lenses**. With `?scene=town-scale` every lens
    has synthetic data.
    Board offers the same lenses over its cards (see Board below).
  - Each agent has one window: World's Inspector, with one top selector
    (**Chat**, **Terminal**, **Files**, **Changes**, then secondary controls such as **Commits**).
    On phones, a header dropdown shows Chat, Terminal, Files and Changes;
    attention choices move into the window's ellipsis menu.
    Tapping an agent or its table, activating it (double-click,
    **Shift+Enter**), **Chat about this** in Needs you and **Next** open that window on
    **Chat**: the conversation's latest 200 entries, which scroll inside the
    window, with **Jump to latest** when you have scrolled back (counting new
    agent messages until you reach the bottom) and the
    composer always at the bottom. In a window 900px or wider (expanded or
    Zen), the conversation fills the window up to 1440px as rows: who, the
    text (prose wraps at about 110 characters; tables, code and tool steps use
    the whole row) and the time at the right edge, once per run of messages.
    A message typed into the terminal as `name: …` by another live agent in
    the same Herdr session shows as that agent's, marked **relayed**. Narrower
    windows and phones keep bubbles. Explicitly opening or returning to Chat
    focuses its message input when available; Desk previews keep focus in the
    queue. Reopening or redocking the window keeps the
    conversation. A new agent without a session shows **No messages yet**;
    missing or unreadable reported transcripts still show their error. A window
    opens on Terminal whenever Chat cannot show its conversation, including
    when a reported record cannot be read. It switches once Chat is available,
    unless you choose a view by hand. While a new window waits, a line under its
    header says Chat is not available yet and offers **Stay on Terminal**. Unavailable messages appear when you
    pick Chat yourself. Chat describes startup
    or a question plainly and offers Open Terminal; integration guidance waits
    while the agent is starting or waiting for you in Terminal. In Town it
    docks on the right by default (**Settings → Inspector opens**), 520px wide
    (at most half the screen) so Town stays in view and lines stay readable.
    Drag its inner edge to resize it; Town remembers the width. It can be
    undocked, and keeps the dock it was left with. On a phone, the Chat view
    shows only its own composer, without the terminal key bar.
  - In Town, Board and Desk, local source links in Chat open the same
    Inspector's **Files** at the referenced line. Relative links use the selected
    agent worktree; unavailable
    or outside-worktree links offer **Choose a worktree**. Web links stay web links.
    Bare filenames use known source/doc formats with a code, line-number or
    standard-document hint; commands and lists keep individual source links.
    Ordinary dotted prose and unrelated code identifiers stay text.
    Spaces keeps ordinary Markdown navigation without an agent-worktree chooser.
  - An agent's known PR announcement or current work claim can show a compact
    pull request card in Chat. **Details** has CI, reviews and your actions;
    **Ask the author to fix** sends `↳ #N` to the author in this conversation.
    The current quest appears as a collapsed title/progress row in the scrolling
    conversation; expand it for objectives.
    Chat's Now status uses a small circle with a status tooltip and screen-reader
    text: blue working ring, yellow needs-you mark, green done tick, grey idle dot.
    An agent out of fuel has a red dot, and the Now bar reads the same words
    as Town's table card, such as `Usage limit reached · resets 15:00 (Codex)`,
    until the limit resets or the agent works again.
  - Chat reuses Terminal's full **Compose** editor, attachments and harness
    command palette, with a separate conversation draft. Enter adds a line;
    Ctrl+Enter, Cmd+Enter or the paper-plane button sends. Type `/` or use
    **⋮ → Browse commands** for suggestions; the paperclip attaches files.
    Every slash command is allowed and stays **sent,
    not checked** until transcript evidence. Native working-state admission
    shows queued message bubbles with the recipient and time; blocked sends
    preserve the draft and the refusal reason.
  - Claude's questions show from its own record: every question, header,
    option and description, and whether several can be picked. Answer buttons
    appear only when the terminal shows that same question; otherwise the card
    keeps the whole question with **Answer in the Terminal** and the reason.
    An unrecognised prompt is shown as the terminal draws it. Before Claude
    has a session, its folder-trust question shows **No, exit** and **Yes, I
    trust this folder**. With pre-approved grants the decline choice can be
    **No, continue without these permissions**, which continues without those
    grants instead of exiting. Chat and Needs you show the folder, full safety
    text and warnings above the choices. A click is checked against that
    question and Claude process, then moves Claude's selection and presses Enter.
  - Harness command menus, such as Claude Code's and Codex's `/model` and
    `/permissions`, appear as a menu card: numbered options, the cursor, the
    footer's keys as buttons and any text field. Each key is checked against
    that menu and session first; follow-up steps replace the card. **⋮** also
    offers the Terminal's key controls (arrows, Esc, Tab, Enter, Ctrl keys),
    sent to the session Chat shows; paging stays in the Terminal.
    When a qualified row read shows that the terminal is too short to read the
    current session's latest command menu, Chat explains this and offers
    **Open Terminal** to fix its size. Unknown sizes do not produce the note.
  - The top selector follows the window's own width, docked, floating or on a
    phone: labelled from 640px, icons (with their names as tooltips) below
    that, and below 360px only the active view, with the others under ⋯.
  - The Town master's chat (**Settings → Town master**, `firstmate` by default,
    matched against the agent's Herdr name, then its label) opens docked on
    Chat once per visit on wide screens, without moving the pane's focus;
    the town center's **Town master** opens it on demand.
  - Hovering an agent shows a small card as a preview: its latest message from
    Chat's conversation read model, rendered as Chat renders it (never terminal
    text; an unavailable conversation shows Chat's reason), a question when
    recognized and supported answer buttons. It is read-only: **Open chat**
    (or **Follow up** for a finished agent) opens the agent's window on Chat,
    where replies and attachments go. The card refreshes when the conversation
    changes, without polling.
  - Tapping an agent or its table brings the agent back: from reception or the
    bar it walks to its desk and stays there until its status changes. A
    table opens its one pane, else the focused pane, else an agent there
    that needs you (waiting, then finished), else the most recently active
    pane. Only a table with more panes than seats and none focused lists
    them to choose. Herdr TUI and herdr-core
    tables open alike: a live core shell opens its terminal and a core agent
    its Chat or terminal, never a refusal; "World can't mark core work
    reviewed yet" shows only on review controls. **Settings → Opening an agent shows** chooses whether that tap opens
    the chat (the default) or the terminal, in Town, Board and Desk alike; either way the tap does not mark
    finished work reviewed. **Open terminal** in the peek does, as before.
  - A seated agent with a quest (its own todo list, plan, Codex goal or loop)
    shows a blue pennant (green when done, amber when blocked) beside it in
    a room or at a desk, with a progress bar when the quest has steps; the
    pennant leaves with the agent. Hover or tap the pennant for **Quest**, its title and progress.
  - Each agent's context fill reads like a needs bar: how much of its model's
    context window its current session uses (Claude, Codex, Pi and Gemini,
    from their own logs). The peek shows a slim bar and the percent beside the
    agent's status, and the agent's window shows the bar under its icon; hover
    either for the reading, such as "Context 72% · 144k of 200k tokens ·
    claude-opus-4-5". At 85% or more the bar turns red and the agent shows a
    sweat drop at its desk: it is about to compact or lose the thread. An
    agent without a reading, or on a model World does not know, shows no bar
    rather than zero. See [harness usage data](../../../../docs/usage.md#context-fill).
  - An agent's peek, and the hover card on its tab or pane row, show its run
    this week: role, item, tokens, calls and largest prompt, such as
    "Fixer · #101 · 12M tokens · 228 calls · largest prompt 176k", with a
    warning line for what may be waste ("fixer round 3 on #101", "context
    86% full"). In the peek the line opens Usage's **Tokens** tab. A pane
    with no run in the read says "This run: usage unknown". An agent of a
    harness World reads no log of shows its time instead, such as "at work
    40 min · tokens and cost not available for this harness".
  - Zoomed into a room, each working agent shows a thought bubble over its
    head with a glyph for the step it runs now: a pencil for editing files,
    a test tube for tests, a prompt for a command, a magnifier for reading or
    searching code, a globe for the web, a light bulb for thinking or
    writing, and two figures for a subagent. A step that has run long for its
    kind (an edit over 3 minutes, a read or fetch over 5, a test run or
    command over 10, a subagent over 20) shows its time in an amber tag. At
    the desk level, or on the selected desk, the bubble adds what the agent
    is doing now and the step with its timer, such as
    `Run the login tests · tests 3m`. The words are the running step's own
    detail (a command's description, the file it edits, the search query),
    else the plan item it marked in progress, else the latest request it was
    given; the terminal title is the last resort, since Claude Code names
    only the session's first topic there. Steps come from the same conversation
    summary as Chat's Now bar, for Claude Code, Codex and Pi; another harness,
    or a tool Town does not know, keeps the typing dots. Town reads steps only
    for working agents on screen at the room or desk level, when the service
    reports their conversation changed, at most 32 per read and one read at a
    time per connection; nothing is polled.
    Bubbles do not move, and hovering the agent still opens its peek.
  - **Open terminal** in the card's header opens the live pane; **Open chat**
    opens the agent's window, whose Files and Changes views hold the rest.
    **Next** opens the next waiting agent's window,
    then finished agents' if none wait.
    **Mark reviewed** in the peek marks the report it shows: it waits while a
    newer stop's report is read, offers **Retry** when that read fails, and
    says so when the mark could not be saved.
    Review marks acknowledge a specific completion in the service's one
    reviewed record, shared by Town, Desk, Needs you and every browser of this
    World, without certifying its correctness. They survive a World restart
    and reappear after the same terminal and known session are verified.
    Upgrading old separate completion checks preserves proven known-session
    reviews; work without session proof may need review once again. Missing Desk
    stop metadata is refreshed before marking, and an unavailable stop stays retryable.
  - **+**, **−** and **ALL** navigate between town, building, room and desk
    detail. Drag to pan; focused arrow keys pan too. Tap a room to zoom in.
    Phones stack buildings vertically; large towns can initially show roofs.
    **Town calm motion** reduces ambient animation.
  - Light is Town's status language. The sky button under **ALL** opens a
    small **Sky** panel. **Time of day** is **Your clock** (follows this
    device's time), **Day**, **Dusk** or **Night**. **Weather** is **Real
    weather** (the default; it follows the [Weather source](../../world-weather/notes.md#weather-source)
    and shows its current reading, such as `Rain 7° · Example City`, or why
    there is none), one held condition (**Clear**, **Cloud**, **Rain**,
    **Snow**, **Fog**, **Storm** or **Wind**), or **No weather**. The panel
    holds no place or source settings of its own: **Weather place and
    source…** opens that row in Settings (Integrations → Sources → Weather).
    Each browser keeps both choices; the button shows the weather Town is
    showing, or the time of day when there is none. As the sky
    darkens, light follows where agents are: a room is lit while an agent
    sits at a desk there working (or waiting on you at it) and is dark
    otherwise; each desk throws its seated agent's state colour (blue-white
    working, amber waiting on you, green done); the bar is lit while anyone
    is at it; and street lamps light the roads. Light changes with the walk:
    a desk and its room light when the agent sits down, and go dark as it
    stands up for the bar or reception. An agent with no status report sits
    at its desk unlit. A reception whose building has someone waiting on you
    pulses amber over its lobby by day and by night; under calm motion or
    reduced motion the pulse holds as a steady mark. An agent or terminal with
    an open question for you counts as waiting on you whatever its runtime
    status; a terminal with no agent throws amber from its desk. A failed
    host's cached building stays dark. Day leaves the town as painted.
  - Town's overlays share one style: the Town board (and its phone chips),
    the zoom and sky buttons, the Sky panel, an agent's peek, toasts, and the hover
    cards of rooms, tables and fuel gauges are the same translucent dark
    panel, with one border, corner, shadow, type and spacing in World's light
    and dark themes, readable over a white roof or the night. Their titles,
    borders, buttons and focus rings are neutral. Amber in them marks only
    what needs you: a **Waiting** count above zero, a waiting agent's peek,
    the first answer to an agent's question and a **low** fuel gauge. The
    sky button keeps one neutral colour at dusk and night.
  - The time of day also gives the town depth. By day each building casts a
    sun shadow that swings from left in the morning to right in the evening,
    short at noon and long toward dawn and dusk, and faint cloud shadows drift
    east across the land. At night street lamps glow at their heads and
    fireflies wander over open grass away from buildings. It stays quiet:
    shadows and clouds lie on the ground under the buildings, so they never
    shade a room, a desk or a status mark, and the status light and amber
    waiting pulse stay above it all. Under calm motion or reduced motion
    nothing drifts: clouds and fireflies hold still. While they drift, Town
    redraws only as often as they move a screen pixel, at most 12 times a
    second. Rugs are woven with a bound edge, and room walls shade the floor
    along their foot.
  - Weather follows the same rules. Clouds thicken and dim the sun; rain
    falls at a slant with a wet street and puddles on roads and the plaza;
    snow falls slowly and lies on the ground; fog veils the land in drifting
    banks; wind speeds the clouds and blows streaks across the town; a
    storm adds heavy rain, a dark sky and a soft, rare lightning flash. Light
    real weather still shows clearly, and a held condition shows at moderate
    strength. Rain, snow and wind streaks fall over the whole visible map,
    buildings and trees included, at every zoom and scroll position; wet and
    snowy ground and fog lie under the buildings and cover all the land on
    screen, the forest around the town included, with no edge. Status light stays above
    the weather, and dark weather lights rooms, desk colours and lamps as
    dusk would, so lit rooms, desk colours, the amber reception pulse and the
    post office read in a storm. Rain, snow and wind streaks keep the same
    density on screen at every zoom, with a fixed cap (a phone shows a little
    more than its share so it never looks patchy), and redraw at most 20
    times a second (snow 12). Under calm motion or reduced motion nothing falls or flashes:
    the street stays wet, snow lies, fog and cloud hold still, and nothing
    redraws for the weather. With **No weather**, or when real weather is
    off, unavailable or expired, Town looks exactly as it does without
    weather.
  - Zoomed into a room or desk, every agent that needs you outside the view
    gets an arrow on the view's edge pointing at it, with its mark (**!**,
    **?** or **✓**); arrows pointing the same way or at one building merge
    with a count, such as `! 3`. Click or tap one and the camera glides there
    and the agent's mark pulses (under calm or reduced motion it jumps, with
    no pulse). On a desktop, **N** moves the camera to the next thing that
    needs you in Needs you's order and opens Needs you at it, with a brief
    "2 of 7 · N next"; **Shift+N** goes back, and after you answer one, **N**
    goes on from there. Both keys are Town actions in Keyboard shortcuts and
    stay silent while you type. Neither answers, reviews or moves anything.
  - Room actions support
    workspace/tab creation and room management on the captured host. Every
    building has a **+ Add room** doorway just left of its bar (just **+** at
    the room-card zoom), which stays put when rooms open, close, move or are
    tidied. It opens New room on that building's host, and the new room
    appears where rooms normally go. For keyboards and screen readers it is a
    button named "Add room to <host>". Room
    plates fit their room width; only the name truncates, with its full text in
    a tooltip. Colour, active/total agent count and blocked badge remain visible.
    Active means working or waiting on you; the total excludes plain terminals.
    Hover the count for its working/waiting breakdown. Hover or focus a plate
    (tap on touch screens) for its card below it: the Town board's numbers
    for that room, without its agents list (Busy, Waiting, Done, Quiet,
    its agents, and its **Economy today**: estimated cost, tokens and models
    from [harness usage](../../../../docs/usage.md); without a price table it says
    "no price table" instead of a cost, and a host whose logs cannot be read
    says "No usage data from this host"), then Rename and Close with 40px
    targets. A
    table, or its nameplate, opens the same card for that table on hover,
    focus or a tap; a click on the plate selects the table and a double click
    opens it. On touch screens one tap opens a live table's default pane; on
    a table with nothing to open at once (a cached host's, or a crowded one)
    the first tap opens its card and a second tap (or a double tap) does what
    a tap does. Zoomed out to the room
    cards, each room's card is a slim label hanging from its rug's top edge:
    its name, a waiting badge and a thin bar of working, waiting, done and
    quiet; hovering or focusing it adds the count line. A mouse anywhere over
    a room shows the same room numbers under its label.
  - **Pin a desk** from the first item in its mobile agent window's **⋯** menu
    (**Pin desk in Town**), or from the desktop window’s **⋯** menu. Pinned
    goes first, as in Herdr's apps: a room's pinned desks take its first
    seats, in tab order among themselves until you reorder them, and the
    other tables follow in tab order; unpinning returns a desk to its
    tab-order seat. Pinned desks reorder on the rug, as pinned browser tabs
    do: drag a pinned desk (mouse or touch) onto another pinned desk of its
    room and it takes that desk's place, or press **M** on a focused pinned
    table and choose a pinned desk's place. Dropped anywhere else (off the
    rug, on an unpinned desk, in another room) it glides back to its seat;
    while you drag, the hint says **Unpin to move it out of the front row**.
    A drag never unpins it, and an unpinned desk cannot take a pinned seat.
    The order is a World view setting saved with the pin (for a core agent,
    beside its shared pin, since Herdr's apps have no order for pins), so
    every device and a reload keep it; Herdr's tab order is unchanged. A desk
    pinned later, here or in a Herdr app, joins the end of the rug; unpinned
    and pinned again, it starts at the end. A folded room always shows its
    pinned desks. The room's pinned seats share one floor rug, a pale woven
    carpet with fringed ends drawn under them as one piece, so the group
    reads at a glance (a room with no pins has none); like the floor, it
    shows wherever the room's interior does. Each pinned desk also carries a
    small quiet pin on its front-left corner, a corner the goal pennant,
    status marks and name never use; neither the pin nor the rug wears an
    attention colour. A desk holds a tab, so a desk with several agents is
    pinned while any of them is. Its agents stay at it:
    they never go to the bar, leave only to wait at reception (blocked, or
    finished and not yet seen) and walk straight back once you have seen them.
    For Herdr TUI agents, the pin stays in World; core pins are shared
    with Herdr apps. Spaces' tab pins (close protection in this browser)
    are separate. A pin
    follows its tab when the tab moves to another room and goes when it closes.
  - **Move rooms.** Drag a room anywhere in its building by the **Move**
    handle in its plaque's card (next to Rename and Close), by its name
    plaque (or its name on the zoomed-out room card) or by its wall. It moves
    with all its tables and agents and stays where you drop it, in whole
    tiles inside the building's walls; rooms in its way move down, and the
    building grows or shrinks to fit. A green outline shows where it will
    stand and pale outlines where the others go. Letting go on its own spot,
    or pressing Escape, returns it. On a phone, drag the Move handle, or touch
    and hold the name or wall, then drag. The card's **Move before …** and
    **Move after …** arrows swap the room with its neighbour, for the
    keyboard. Rooms stay in their own building; in a machine's building a room
    can move among either runtime's rooms, while desks and agents keep to
    their own runtime. World saves where the
    rooms stand with the Board layout (like pinned desks), so a reload and
    every device show the same arrangement, and puts Herdr's workspace order
    in reading order (top to bottom, left to right), so Spaces lists the
    rooms as Town shows them. herdr-core has no workspace order: its rooms
    keep only their saved spots. A building whose rooms were never moved still
    stacks them in Herdr's order.
  - **Tidy rooms.** **Tidy rooms** (sparkles) on a building's sign, or the
    sparkles button on its reception board (next to its colour), puts every
    room of that building back in order in one step: in Herdr's workspace
    order, each room joins the shortest of the building's columns, two tiles
    apart, with no gaps or overlaps, exactly as a building whose rooms were
    never moved stacks them. The rooms glide to
    their new spots (or simply stand there under calm or reduced motion), and
    World saves the result like a room move, so it stays after a reload and
    Spaces keeps the same order. Tidying a tidy building changes nothing.
    **Undo** in the note that follows (for five seconds) puts the rooms back
    where they stood. Rooms still move freely afterwards.
  - **Bin and bus.** Dragging an agent (or a desk) onto the bin icon at the
    bottom of Town or Board, or onto a Town bus stop, or **Put in bin** in an
    agent window's **⋯** menu (from Town, Board or Desk) holds the agent;
    nothing closes yet. In Town it walks out of its building's front door to
    the London bus stop (red roundel) nearest its room, the same character
    walking as it does indoors, whether it was dropped on the bin or a stop
    (one binned on Board walks out the first time Town shows it); its seat
    fades into the carpet and crumbles, the whole desk when all its agents
    are binned;
    those waiting at a stop queue along its pavement in joining order, in
    two rows when long, with a **+N** board at the end for any more; one put
    back walks home from the queue and those behind step up;
    there is a stop at every road crossing, the leftmost included (crossings a
    step or two apart on one street share one); its sign
    is street furniture like the lamps, drawn behind buildings and agents and
    under labels and panels, and shrinking with the town as it zooms out (on
    a phone zoomed far out, the floating bin is the easier target). A
    countdown board over those
    waiting shows the bin's own countdown, from the one bus timetable: the
    time until the next bus sets off from Apartments, **on its way** while a
    trip is out and **stopped** while it stands. Every stop and the bin read
    the same value at the same moment. The bin floats at the bottom of the screen and
    lights up during a drag, so a phone needs only a short drag, and the town
    does not scroll while the drag rests on it. A red
    double-decker lives at Apartments' stop, on the last street by a
    footpath down to the building's door (its green house sign marks it),
    and sets off every four minutes on a fixed schedule when someone is
    waiting. It drives only the town's roads, by the nearest way round the
    stops with riders and back, never off the map: it turns its corners,
    slows to each stop and waits there about ten seconds with its door open
    while its riders step on, and its riders show in its windows the whole
    way (in its side windows, or its front and back windows on a road up
    or down the screen). Back at
    Apartments it opens its door, its riders step off one by one and walk in,
    and the sign counts each as it goes in; the last is in just as the trip
    ends, which is when their agents close. Where the town is too small for
    the building, the bus stops at the town center's door instead, which
    opens Apartments. Agents put in the bin while
    the bus is out wait for the next one. Tapping the bus stops it where it
    is and opens the tray (nothing closes while it stands); **Let the bus
    go**, or closing the tray, sends it on. The bin (always shown in Town and on Board, in other views while
    it holds agents; on a phone, also a stop or the bus in Town) opens the
    tray: who waits, the time to the next bus, **Put back** (until the trip
    ends, even after boarding; it walks back to its desk from its stop) and
    **Close now**. A pinned desk's or pinned tab's last agent cannot go
    in the bin, and its close never takes a pinned tab's last pane. Closes are qualified by host
    and runtime: a host that restarts keeps its agents, and restarting World
    drops the bin without closing anything. Only Town speaks of the bus:
    elsewhere the bin reads **Cleaning up** and how many, and its tray says
    when they close. Closed agents move into
    [Apartments](../apartments/notes.md#apartments-finished-agents).
  - Cached failed-host buildings, agents and Board cards stay stale and
    non-actionable. **Disconnected · Reconnect** appears on Town's building and
    reception and Board's host label. A live herdr-core host is never stale
    there: Board offers its **+** (New workspace) instead. When the local connection is failing and
    no host is ready, Town's stage also offers to set up a runtime. With no
    runtime installed it offers **Set up herdr-core** first and **Use the Herdr
    TUI instead** second; with Herdr installed but stopped it offers to start
    Herdr. **Set up herdr-core** shows the version, where core goes
    (`~/.local/bin/herdr-core`; on Windows
    `%LOCALAPPDATA%\Programs\herdr-core`), that it is checksum-verified and starts at
    login, then **Install and start** runs it on this computer only, with
    progress and plain errors (**Try again**). Nothing installs or starts
    before you confirm, and the card never appears during a normal start or
    after you disconnect. Once core connects, the card goes away.
    Transient local socket failures and SSH outages keep retrying with
    capped backoff; explicit disconnect/removal and permanent failures stop
    recovery. Cached work never becomes current until a fresh runtime snapshot
    is admitted. Search and Hosts
    use the shared aggregate. Reception and bar positions only show status;
    only an explicit move changes Herdr's layout, always within one host.
    Terminal title-spinner and scroll repaints keep healthy hosts actionable;
    topology or agent-state changes still require a fresh observation.
  - **Search shows where things are.** Town's search hangs from the top
    edge beside the view buttons in Zen, World's default, and sits in the top
    bar when the bars are shown; on a phone in Zen it is the search button in
    the bottom-right corner. On a desktop the search of Town, Board and Desk
    rests as a search icon whose tooltip names its keys; a click unfolds the
    search box with the cursor in it. **Escape**, or leaving an empty box,
    folds it back into the icon; a query keeps it open. Typing in Town's search lights up the
    matching buildings, rooms, tables and agents on the map and dims the rest
    of Town a little; the camera stays put. The result line counts matches and
    how many are off-screen ("7 matches · 3 off-screen"). Choosing a result (a
    click or tap, or **Up**/**Down** then **Enter**) moves the camera to it at
    a readable zoom and pulses it; choosing it again, or **Enter** a second
    time, opens it as selecting does. Town's own places are found too:
    "warehouse" (or "pull requests") lists the **Warehouse**, and choosing it
    moves the camera there; choosing it again only shows it again. A result Town does not draw, such as
    an agent at a table its room folds away, opens at once and counts as
    off-screen. Under **Town calm motion** or reduced motion the camera jumps
    and nothing pulses. **Escape** (in the box, on a result or on the map),
    the phone search's **✕** or an empty box ends the search and returns the
    camera to where the search found it. **/** or **Ctrl+F** (**Cmd+F** on a
    Mac) unfolds the search of Town, Board or Desk with the cursor in it, or
    opens the phone's search, unless you are typing in a terminal, the Chat composer or
    another text field; the browser's own find stays closed. Change the keys
    under **Search the current view** in Settings → Shortcuts.
  See the [Town exercise](../../../../docs/TUTORIAL.md#town).
