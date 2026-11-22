# World needs you

## Purpose

Define the user-facing needs you contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Needs you backlog dismissal

Needs you SHALL offer one labelled action to dismiss every open question from
one verified connection/terminal when it has multiple questions.

#### Scenario: Needs you backlog dismissal acceptance rules

- **WHEN** World records or presents questions and work needing the user
- **THEN** Its count and
  scope SHALL include the full backlog across pages, runtime generations and
  sessions, including questions no longer attached to a live agent. Matching
  names or unverified pane claims SHALL NOT group different askers. Saving SHALL
  disable repeat input, report failure in place and allow retry without hiding
  unsaved questions. A successful dismissal SHALL update the shared open-question
  list and count without inventing an answer.

#### Scenario: Backlog spans generations and pages
- **WHEN** the owner selects the asker's labelled Dismiss all action
- **THEN** that asker's entire open backlog leaves Needs you in one step
- **AND** other askers' questions stay visible, even if they share a display name

### Requirement: Durable user asks from crew panes

The watcher, dispatcher and workers SHALL reach the user through the existing
World ask ledger from their own panes.

#### Scenario: Durable user asks from crew panes acceptance rules

- **WHEN** World records or presents questions and work needing the user
- **THEN** They SHALL NOT substitute custom Herdr
  notifications, user-seat prompts, shared-runbook/configuration edits or issue
  comments for asking. A worker awaiting a decision SHALL use the existing ask
  wait path; the watcher SHALL keep passes nonblocking, record one ask per cause,
  read a user answer once into its own output/feed and withdraw the ask when
  the cause clears. Scoped passes SHALL leave other PRs' asks alone, and held PRs
  SHALL produce no new user asks. A producer SHALL retain creation uncertainty
  before dispatch and recover a persisted ask by occupant-scoped cause key before
  retiring a cleared cause, including when its creation reply was lost. A lost
  withdrawal reply SHALL NOT suppress a recurring active cause, including one whose
  answer was already read. Withdrawal uncertainty SHALL be retained before dispatch
  and settled before creating the next occurrence. Holding a PR or moving it out of
  scope SHALL preserve owner receipts and answer acknowledgements. Superseded legacy
  notices without receipts SHALL NOT trigger withdrawal or a new feed entry. A keyed
  withdrawal returning not_found SHALL report no recorded ask, never a successful
  withdrawal. Permanent withdrawal refusal SHALL retire the cleared cause and report once that its question is left
  for the user to answer; transient failures SHALL remain retryable.

  The ask command SHALL accept a bounded optional cause key scoped to its verified
  asking occupant, return the same retained ask for repeated causes including
  answered ones, and allow a new occurrence after withdrawal. Only the original
  verified connection, runtime, terminal and session SHALL withdraw an ask.
  Withdrawal SHALL be idempotent, preserve an answer already recorded, release
  waiting reads without inventing an answer, and remove the question from every
  open-ask projection. Withdrawn questions SHALL share the existing ledger's
  closed-question retention bound. A withdrawn ask SHALL reject later answers. Withdrawal by cause key SHALL resolve
  only the original verified asking occupant's retained question, prefer its active
  occurrence, remain idempotent and never create a question. A keyed repeat SHALL
  return its retained answer state. Human withdrawal output SHALL name both its
  withdrawn state and any answer preserved before withdrawal.

  World SHALL announce newly observed placed asks through its existing chime,
  toast and OS-notification preferences, naming the asker with an unverified
  mark when it applies and quoting the question's first line. One page SHALL announce an ask ID only
  once while retained in its bounded seen set, without replaying the initial
  backlog. The common shell SHALL observe asks in every view. A local ask event
  SHALL retain its local OS-notification path when Web Push is selected. Open
  agent SHALL carry the original runtime, terminal and agent-session identity,
  refuse replacement targets and preserve the host filter. Obsolete socket or
  revision replies SHALL NOT restore answered, dismissed or withdrawn asks.

  An ask from a caller the service cannot verify SHALL stay unverified: it SHALL
  NOT use cause keys or withdraw, and it SHALL share the unverified allowance.
  When exactly one local Herdr has the pane it claims, the service SHALL record
  that pane's connection, runtime, terminal, workspace and agent session with the
  ask, so World places it as it places a verified ask; otherwise the ask SHALL
  remain in the question list only. Every other candidate local runtime SHALL
  explicitly report that pane absent; a failed, unsupported or malformed read SHALL
  leave the ask unplaced. The service SHALL record Herdr's name for an
  asking agent. The question list SHALL name each asker as Town names its desk,
  else by that agent name or its pane, mark an unverified asker once, and offer
  Open agent for each placed ask, including every ask from one pane, opening the
  asking agent, or the terminal of an asking pane without one.

  The user SHALL be able to dismiss any open ask in World. Dismissal SHALL close
  the question without an answer, release waiting reads with a dismissed state,
  remove it from every open-ask projection and reject later answers. A keyed
  repeat SHALL return the dismissed question, as it returns an answered one,
  until the asker withdraws it, and the watcher SHALL NOT ask again for a
  dismissed cause while that cause holds.

  The ask command SHALL alert the user about each newly recorded question
  through the asking pane's Herdr with a request-sound notification naming the
  asker, the question and its ID, so the alert reaches Herdr's clients, every
  World connected to that Herdr and Web Push. A repeated cause that returns a
  retained ask SHALL NOT alert again. When the service cannot record a question,
  the command SHALL still send the alert, naming that failure, and SHALL exit
  `unavailable` (1) with the service's reason. When Herdr reports that no client
  was shown the alert, the command SHALL exit with `not_delivered` (6) and the
  recorded question ID instead of waiting, and SHALL NOT report success. Every
  ask reply SHALL state whether the question was recorded and what the alert
  reported, or that no alert was sent for a retained question, and a waiting
  reply SHALL keep that outcome through its answer, closure or timeout.

<a id="scenario-an-ask-alerts-the-owner-through-herdr"></a>

#### Scenario: An ask alerts the user through Herdr
- **WHEN** an agent records a new question and its Herdr shows the alert
- **THEN** the command succeeds and reports what Herdr showed
- **AND** repeating the same cause key does not alert again

#### Scenario: Nobody receives the alert
- **WHEN** World records a question but Herdr reports that no client was shown
  the alert
- **THEN** the command exits `not_delivered` with the question ID and does not
  wait for an answer

#### Scenario: A crew cause needs a user decision

- **WHEN** a blocked author, READY PR or stuck dispatch is observed in one pass
- **THEN** its producer records one durable user ask from its own verified pane,
  World shows its question and announcement, and the user can open and answer it

#### Scenario: A cause clears after its ask was delivered

- **WHEN** a producer's cause clears, including readiness changing on the same head
- **THEN** the original asker withdraws the ask and all open-question markers clear,
  while any answer recorded first remains on the same ledger question

#### Scenario: The user dismisses an ask

- **WHEN** the user dismisses an open ask in World
- **THEN** every open-question marker clears, the asker's wait ends with dismissed
  and no answer, and its keyed cause is not asked again until it clears

#### Scenario: A caller World cannot verify asks from a known pane

- **WHEN** a caller the service cannot verify claims a pane that one local Herdr has
- **THEN** that pane's agent or terminal waits at reception with a question mark,
  and the question list and announcement name it with an unverified mark

### Requirement: Needs you tab

World SHALL present what waits on the user in one Needs you tab, the same in
Town, Board, Desk and on phones: open user questions oldest first, then blocked
agents oldest first, then finished work not yet reviewed newest first (done
agents, and idle agents whose turn the service saw end within Desk's 12-hour
window).

#### Scenario: Needs you tab acceptance rules

- **WHEN** World records or presents questions and work needing the user
- **THEN** On wide landscape screens the open tab SHALL sit on the left beside the
  view, on narrower screens over it, and on phones it SHALL be a full-screen list
  with Back that takes keyboard focus (the requested item, else Back), keeps the
  app behind it inert, and returns focus to its opener when it closes; an agent
  window opened from it SHALL cover it until that window closes, and focus SHALL
  then return to the list. Whether it is open SHALL persist per device, and while it is closed
  and something waits a handle at the left edge SHALL open it. Each item SHALL be
  a short message from its agent, name its agent, mark an asker World could not
  verify, show why a user alert may not have arrived, and offer a chat icon,
  which opens that exact agent's Chat; the agent's name SHALL open that same Chat
  on every item whose agent World can place. Every item SHALL have one compact
  anatomy: a header row with the agent's mark, name, place and age and its icon
  actions, the message, and answer controls only when the agent asked something.
  Every icon SHALL have an accessible name and a tooltip. A ✕ icon SHALL keep its
  kind's own action, never another kind's: Dismiss on a question, Mark reviewed on
  finished work, and none on a blocked agent. Every item's message SHALL show its
  first two lines with a visible more while it runs longer, and SHALL expand in place
  to the whole message, links included, on more or a tap on the clipped text (a
  link opens rather than expands), and less SHALL clip it again. Keyboard focus
  entering a clipped message SHALL reveal its content without moving focus;
  collapsing with less SHALL keep focus on that control. Expanding SHALL
  move nothing above the item and keep its answer controls on it; hovering its agent's name
  SHALL show the agent's card with its latest message. A question SHALL be
  answerable with its options as quick replies or typed text (one answer field
  when it offers no options), or dismissed. A blocked agent's own
  question SHALL be answered with Chat's checked answer and show Chat's receipt,
  including an unconfirmed answer's warning and the agent's Terminal; a prompt
  Chat cannot answer SHALL offer the Terminal, never Chat. Finished work SHALL
  offer Mark reviewed for the stop whose report is shown, unavailable while the
  current stop's report is being read, SHALL say when that report could not be
  read and offer to read it again, and SHALL report a mark the service did not
  save. A report the service could not read SHALL count as a failed read, never
  as the current stop's report. An answer's receipt, question and pending result
  SHALL belong to the exact pane owner and agent session: a new session on the
  same pane SHALL start without them. Blocked and finished items SHALL come from
  the hosts the Hosts filter admits. A Needs you counter in the existing top bar (in the view picker in Zen; a phone's top bar
  outside Zen, as an inbox icon with a count badge, hidden at zero, right after the view's name, never an agent window's bar) SHALL count open questions and the admitted blocked agents and
  open the tab; Town's reception letters, Desk's Answer and Board's attention
  badges SHALL open it at their item. The tab SHALL show and observe one bounded
  page of items at a time, with actions to show the next and earlier pages, and
  every opener request, including a repeated one for the same item, SHALL turn
  to the page holding that item. When Town has saved answers to check, the tab
  SHALL offer a route to Town's Summary Outbox. A keyboard command in Town SHALL
  open the next agent that needs the user.

#### Scenario: Work through waiting agents on desktop

- **WHEN** three agents in two hosts are blocked and the user presses Town's next-agent key repeatedly
- **THEN** Town opens each agent's exact pane in age order and the Needs you
  tab reflects each answer without reordering unrelated entries

#### Scenario: Read a long question before answering

- **WHEN** an agent asks a question longer than two lines, with a link to its pull request
- **THEN** its Needs you item shows the first two lines with more, a tap shows the whole question in
  place with the link working, its answer controls and Dismiss stay on the item, and the agent's name opens its Chat

#### Scenario: Open Needs you at an agent past the limit

- **WHEN** more agents are blocked than the tab shows and the user uses Desk's Answer on one past the first page
- **THEN** the tab opens at the page showing that agent's item, the others stay a page away, and turning pages never observes more than one page of agents
- **AND** after turning back a page, using Answer on the same agent again turns to its page

#### Scenario: Review where the report is shown

- **WHEN** the service observes a new stop for a finished agent while Needs you still shows the earlier report
- **THEN** Mark reviewed stays unavailable until the new report is read, and then marks the new stop
- **AND** a read that fails says so and offers Retry instead of waiting for a change that a finished agent never makes

#### Scenario: Review work Desk names no stop for

- **WHEN** a finished agent has no stop the service saw and Herdr reports no activity time, and the user marks it reviewed
- **THEN** the service records a check for its terminal, and Town, Desk and Needs you all show it reviewed until the agent works or asks again
