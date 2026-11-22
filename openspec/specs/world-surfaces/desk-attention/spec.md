# World desk attention

## Purpose

Define the user-facing desk attention contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Desk attention triage

Desk SHALL present every current actionable agent within the host filter by what it needs from the
operator.

#### Scenario: Desk attention triage acceptance rules

- **WHEN** World observes agents or presents and updates Desk attention
- **THEN** Needs you SHALL list blocked agents, oldest wait first, with the question read from the
  bottom of the agent's visible screen. To review SHALL list done agents, idle agents whose latest turn
  ended within 12 hours, and agents the World service observed stop working within 12 hours, each with its
  turn receipt or, without one, its latest screen lines. In flight SHALL list working agents with their
  current request and a live screen line. Remaining agents SHALL collapse into a quiet list. Cards and
  rows SHALL name each agent by the name the operator gave Herdr, otherwise the thread title its harness
  writes to the terminal, otherwise the harness, and SHALL show its harness, model, workspace, tab and
  working folder when known. Every card and row SHALL identify its owning host.
  Desk SHALL offer three modes and SHALL open on Now for each browser session: Now (the lanes above),
  Agents (every current actionable agent within the host filter, agents recently opened from the Desk first, then
  workspaces, grouped by workspace identity and ordered by their most recently active agent) and
  Reviewed (each agent's latest stop that the operator marked reviewed, newest first and reopenable,
  while that agent remains idle or done). Older stops are not retained. One search SHALL filter every
  mode by agent name, thread title, harness, workspace, tab, folder, request and report. Marking a
  stop reviewed SHALL offer an immediate undo.
  On wide screens, opening an agent from the Desk SHALL show its existing Inspector docked beside the
  Desk as a reading pane, with the lanes folded into one prioritized queue. Moving through the queue
  with J and K SHALL show the next agent in the reading pane without moving keyboard focus out of
  the queue, Enter SHALL move focus into its terminal, and Esc SHALL close the pane. On narrow screens
  the Inspector SHALL open full screen instead.
  Receipts, full reports and screen reads SHALL target each leaf's immutable connection ID and runtime
  generation. Every card's primary action SHALL open the existing terminal Inspector for that exact
  connection-qualified pane. Desk SHALL NOT send terminal input, answer approvals, assign tasks or run
  lifecycle commands itself. Review marks SHALL apply to one stop of one agent session and SHALL remain
  unavailable until a receipt has been read for the agent's present state; when no receipt can be read
  for that state, the stop SHALL become markable without one. Keyboard shortcuts (J and K to move, Enter to
  open, E to mark reviewed) SHALL apply only while focus is on the Desk or the page itself, SHALL NOT
  replace the native activation of a focused control, and SHALL act on the card that holds keyboard
  focus: focusing any control in a card makes it the active card, J and K move keyboard focus with the
  highlight, and focus stays on the same agent while lanes reorder.
  Within the shared shell, Desk SHALL participate in the shell Actions menu, window arrangements of the
  Inspectors it opens, and view-local failure isolation. On wide screens it SHALL select the agent shown
  in its reading pane only to dock that agent's Inspector; other selection-driven behavior
  (visual-route Action targets, the shared view-control search and watched visual projection) SHALL
  NOT apply to it. Managed hosts outside the filter SHALL appear as read-only summaries drawn from
  the aggregate observation. Expanding a summary SHALL list its observed agents without changing the
  filter or admitting receipt, screen or Inspector resources. Each current agent SHALL offer an
  explicit Reveal & open action naming the agent and destination host. After validating the captured
  connection, runtime, pane, terminal and agent session against the current observation and a qualified
  live pane read, this action SHALL add that host to the existing filter before opening that agent's
  Inspector. All hosts SHALL remain All hosts. Existing Inspectors and their resources SHALL retain
  their owning hosts. Qualified focus admission SHALL recheck the captured agent session before
  focusing. A later opening, leaving Desk or unmounting SHALL permanently supersede pending reveal
  reads and Inspector admission, including queued native focus; returning to Desk SHALL NOT revive
  them. Filter changes already explicitly applied SHALL remain. Supersession SHALL NOT classify a
  current agent as unavailable, disable its next reveal attempt or record a recent open. Cached, unavailable, retired or replaced agents SHALL explain their state and SHALL NOT
  open a replacement session, fall back to another host or broadcast an operation.
  Review marks, observed stops and recent opens SHALL be scoped to the connection, runtime generation,
  pane and agent session across host filter and operational focus changes, so they never carry over
  to another session or a same-named pane on another host.

#### Scenario: Answer a blocked agent

- **WHEN** an agent within the host filter is blocked on an approval
- **THEN** its Needs you card shows the approval question and choices from its screen, and Answer
  opens the Needs you tab at that agent without Desk sending any input

#### Scenario: Review a finished turn

- **WHEN** an agent finishes a turn
- **THEN** its card moves from In flight to To review with the request, closing report, duration,
  tool calls and edited files, and marking it reviewed hides only that stop

#### Scenario: Return to a reviewed stop

- **WHEN** an operator marks a stop reviewed and later wants it back
- **THEN** Undo restores it immediately, and while the agent stays idle or done, Reviewed lists that
  stop with its receipt and a Reopen action

#### Scenario: Find the agent worked with recently

- **WHEN** an operator searches for words from an agent's thread title, tab, folder or request, or
  opens Agents
- **THEN** the matching agents appear with those identifying details, with agents recently opened
  from the Desk listed first, and selecting one opens its terminal Inspector

#### Scenario: Work through the queue beside a reading pane

- **WHEN** an operator on a wide screen opens a card and then presses J
- **THEN** the agent's Inspector stays docked beside a one-column queue and shows the next agent,
  while keyboard focus stays in the queue until Enter moves it into that terminal

#### Scenario: Keys aimed at other controls

- **WHEN** a keyboard user presses Enter on a focused button or in the top bar while Desk is shown
- **THEN** that control activates normally and no terminal Inspector opens

#### Scenario: Colliding agent panes on filtered hosts

- **WHEN** two filtered hosts expose the same native pane ID
- **THEN** Desk triages both agents and reads each host's own receipt and screen, and reviewing one
  stop does not mark the other host's stop reviewed

#### Scenario: Reveal an agent outside the host filter

- **WHEN** an operator expands an outside-filter host summary and chooses Reveal & open for a current agent
- **THEN** the action names that agent and host, validates its captured identity, adds the host to the existing
  filter and opens its own Inspector while preserving previously open contexts and their resources
- **AND** merely expanding the summary does not change the filter or read that agent's receipt or screen

#### Scenario: An outside-filter agent retires before opening

- **WHEN** an expanded summary is cached, its host becomes unavailable or its runtime or agent session changes
- **THEN** Desk explains why the captured agent cannot open, without opening another host or replacement session

#### Scenario: Leave and return while a reveal read is pending

- **WHEN** an operator leaves Desk and returns before a captured live read completes
- **THEN** the old reveal stays cancelled and cannot widen Hosts or open an Inspector

#### Scenario: Supersede queued Inspector admission and retry

- **WHEN** an operator leaves Desk, unmounts it or starts a newer reveal while Inspector admission is pending
- **THEN** cancellation stops subsequent queued native focus dispatch and Inspector publication
- **AND** already applied filter changes remain, current agents stay retryable and no recent open is recorded
- **AND** genuine identity and live-read failures continue to explain why their captured agent cannot open

### Requirement: Shared bounded Desk state

The World service SHALL hold review marks, observed stop times and recent Desk
opens in world.sqlite, shared by every connected browser after COMMIT.

#### Scenario: Shared bounded Desk state acceptance rules

- **WHEN** World observes agents or presents and updates Desk attention
- **THEN** It SHALL retain
  current terminal/session stop records for as long as their source and session
  remain current. Current stops SHALL NOT be evicted by a record-count limit or by
  history. Inactive/ended captures SHALL form history, bounded to 500 rows with
  oldest-first eviction; history may yield earlier to the byte budget. Known-session
  restart captures SHALL remain unprojected and protected while their source is
  recovering, until fresh classification or confirmed unavailability. There SHALL
  still be at most 40 recent-open timestamps and 4,096 prior status observations in
  memory. Both the Desk projection and its serialized SQLite rows SHALL fit a
  768 KiB metadata budget, leaving headroom below the unchanged 1 MiB frame limit.
  An over-budget observation or mutation SHALL produce a labelled capacity refusal
  without evicting current stops or acknowledging an uncommitted review. Each durable record SHALL have a World ID and
  a verified binding to its original source, terminal and known agent-session
  fingerprint (or terminal alone for explicit unknown session). Runtime generation
  SHALL qualify only the current projection and admitted work. Review marks SHALL store only the latest marked stop per agent
  session; Reviewed SHALL retain its existing latest-stop presentation for idle or
  done agents. Exact Undo SHALL remove only the stop it names, preserving any newer
  mark from another browser. Metadata SHALL survive browser reloads and host-filter
  changes and service restarts. Runtime replacement SHALL hide projections until
  fresh verification; complete current terminal absence or positive known session
  replacement SHALL clear records. Browser-local Desk metadata SHALL NOT be imported.
  A shared stop identity SHALL be independent of a browser's receipt polling or
  read failures: the same service stop and native activity observation SHALL have
  one identity with or without a receipt. A later observed stop or native activity
  SHALL invalidate the older mark. Receipt content SHALL remain presentation data.
  The service SHALL assign a stable observed-stop identity separate from the
  12-hour display timestamp. Every fresh admitted stopped agent, including one
  already done on first observation/startup/new connection/runtime generation,
  SHALL receive a current stop identity. First observation SHALL NOT invent a
  historical transition or stop time: its display timestamp remains absent unless
  World observed a transition or qualified native progress. Timestamp expiry SHALL
  retain the identity even before the stop is reviewed or opened. The existing
  12-hour idle presentation window SHALL remain unchanged. Qualified native `state_change_seq` progress in an
  already stopped state SHALL reveal a subsequent stop even if no browser observed
  the intervening working state. Native progress checkpoints on retained metadata
  SHALL survive display/observation expiry. Equal, older, malformed or ambiguous
  native progress SHALL NOT invalidate a mark. Without a native sequence, a known
  idle/blocked-to-done or blocked-to-idle completion transition SHALL still advance
  the stop. Unknown-session Desk captures SHALL NOT inherit review or stop identity
  across World/runtime restart or null-to-known ownership changes without native
  continuity proof. The currently supported native observations provide no runtime
  instance proof: old unknown captures remain unassociated bounded history and a
  fresh current stop is created. Returning to an earlier known fingerprint after
  an intervening owner SHALL NOT restore its old review.
  The stable observed-stop identity SHALL participate in receipt refresh and
  currency admission. A read started for a preceding stop SHALL NOT become current
  for its successor. While a new stop's receipt is pending or failing, the previous
  report SHALL NOT enable marking; an unreadable stop may settle without a report
  under the existing bounded retry policy. Pane rows alone SHALL supply the observed
  agent harness and session identity. Matched agent.list status and sequence data
  SHALL be used only when its session fingerprint agrees with the pane's; metadata
  SHALL NOT fill in a missing pane identity.

  Mutations SHALL validate the exact live terminal and session through a current
  runtime lease and revalidate that lease after the read. Observed stops SHALL come
  only from fresh admitted host reads; cached, failed, invalidated or retired reads
  SHALL NOT record transitions. A host read begun before a newer metadata mutation
  SHALL NOT replace its session identity. A metadata admission started before a
  newer session observation or mutation SHALL NOT restore its replaced session,
  even if the original fingerprint subsequently reappears. Status observations
  of an already-known same session SHALL NOT retire a valid metadata admission.
  Observed-stop display times SHALL expire after 12 hours; expiry alone SHALL NOT
  reopen an unchanged reviewed idle/done stop.
  The service SHALL notify all browsers on real metadata changes. Browsers SHALL
  reject replies from an older socket epoch or service revision, treat disconnected
  state as unverified, and accept a restarted service's empty revision-zero state.

#### Scenario: Review on a phone and undo on a desktop

- **WHEN** one browser marks an agent's current stop reviewed
- **THEN** another browser connected to the same service sees it reviewed, and
  Undo from either browser restores that exact stop without removing a newer mark

#### Scenario: Reload a browser or restart the service

- **WHEN** a browser reloads while the World service still runs
- **THEN** it reads the same qualified marks, stop times and recent opens; after
  a service restart, captures remain unresolved until fresh complete identity
  verification; known sessions restore their exact stop and review, while unknown
  sessions receive fresh stops without inheriting unproven acknowledgements

### Requirement: Bounded turn receipts

The service SHALL answer `agent_turn.get` for an exact pane and agent session by deriving the latest
turn from the session transcript it already resolves for Agent History, without storing it.

#### Scenario: Bounded turn receipts acceptance rules

- **WHEN** World observes agents or presents and updates Desk attention
- **THEN** When the
  caller names the session fingerprint it shows, the service SHALL return no receipt if the pane runs
  another session before or after the read, and the browser SHALL publish a receipt or complete report
  only for the session and stop that its card shows. Stop identities SHALL name the session file, not
  only its file name. A turn
  SHALL consist of the steps after the latest user message. The receipt SHALL carry at most 600
  characters of the request, at most 2,400 characters of the closing agent message (up to 32,000 when
  the complete report is requested, with truncation reported), start and end times from agent steps,
  tool-call and command counts and at most 24 edited file paths. Projection placeholders (such as
  reasoning and usage records) and trailing system records SHALL NOT become the report, extend the
  duration or change the stop's identity.

#### Scenario: A hook record arrives after a reviewed stop

- **WHEN** a system record is appended to a transcript after a stop the operator marked reviewed
- **THEN** the receipt keeps the same stop identity, report and end time, and the stop stays reviewed

### Requirement: Bounded Desk observation

Desk SHALL partition and count every current actionable agent within the host filter.

#### Scenario: Bounded Desk observation acceptance rules

- **WHEN** World observes agents or presents and updates Desk attention
- **THEN** Each
  browser's Desk SHALL choose receipts for at most 40 agents and visible screens for at most 16 panes
  globally, choosing blocked, then done, working and idle agents first. Capacity SHALL be shared
  fairly among hosts within each urgency tier. When the World service advertises
  `world_shared_acquisition`, Desk SHALL declare its chosen targets to the service, which SHALL read
  each declared target once for all browsers that declare it, with independent per-host queues.
  Otherwise each browser's Desk SHALL read its chosen targets itself, with independent per-host
  queues, as before this change. Failed or retired hosts SHALL NOT redirect reads to another host or
  prevent healthy hosts from being read. Pending reads SHALL retain active admission until
  settlement; status, activity and visibility refreshes SHALL coalesce queued work without
  overlapping reads of the same kind on one host. Receipts SHALL refresh on a status or activity
  change and every 20 seconds; screens SHALL refresh every 4 seconds. While its page is hidden or its
  Desk is closed, a browser SHALL release its declarations, or stop its own reads including reads
  already queued, and resume when shown. The service SHALL stop reading a target that no browser
  declares, including reads already queued. A browser that starts declaring a target SHALL receive
  its latest result only once a read exists, never a placeholder. Receipts and screen excerpts SHALL
  be keyed by connection, runtime generation, pane and agent session, so a replaced session never
  shows the previous session's text and a refresh does not remove a shown receipt.

#### Scenario: More agents than the read bound

- **WHEN** a host has 40 idle agents and one blocked agent
- **THEN** the blocked agent appears in Needs you and is among the agents whose screens and receipts
  are read

#### Scenario: A Desk read completes after host retirement

- **WHEN** a receipt, full report or screen read completes after its runtime is retired
- **THEN** its result is not published and healthy hosts remain independently readable

#### Scenario: Slow Desk host alongside a healthy host

- **WHEN** a filtered host's receipt or screen read remains pending
- **THEN** another host's receipts, review controls and screen reads progress independently,
  and equally urgent hosts share the bounded read admission fairly

#### Scenario: Two browsers show the same Desk

- **WHEN** two visible browsers show Desk for the same agents
- **THEN** the service reads each declared screen once every 4 seconds and each declared receipt
  once per refresh, and both browsers show the same results

#### Scenario: Service without the capability

- **WHEN** the World service does not advertise `world_shared_acquisition`, for example after a
  rollback
- **THEN** each browser's Desk reads its own chosen screens every 4 seconds and its receipts every
  20 seconds and on a status or activity change, as before this change

#### Scenario: One of two browsers stops showing Desk

- **WHEN** one of two browsers showing the same Desk is hidden or closes Desk
- **THEN** the other browser's screens and receipts keep refreshing, and the service stops a read
  once no browser declares it
