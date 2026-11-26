## MODIFIED Requirements

### Requirement: Town agent peek

Hovering an agent or a reception entry with a pointer SHALL open a
peek after a short delay, and tapping one SHALL open a pinned peek.

#### Scenario: Town agent peek acceptance rules

- **WHEN** World presents agent peeks or opens their resources
- **THEN** The peek SHALL
  show the agent's name, location and status, its latest message (the question
  when it is waiting), answer options only when the pane's latest lines present a
  numbered menu or a yes/no prompt, and actions to reply, open the Inspector, open
  the terminal from the peek's header and go to the next waiting agent. Tapping an
  agent, or the table of an agent away at reception or in the lounge, SHALL open
  what the Agents open preference names: the agent's one window, World's
  Inspector, on its Chat view (the default) when Chat reads the agent's harness,
  otherwise its terminal; tapping a room SHALL only zoom to it. Activating an
  agent or its table, the needs-you list, N and Next SHALL open the agent the same
  way, and so SHALL opening an agent's card or pane row in Board and an agent in
  Desk; a plain shell SHALL open its terminal. No separate peek chat window SHALL
  exist, and the peek card SHALL only preview an agent on hover. In Town the
  Inspector SHALL dock right by default and keep the dock each window was left
  with. Its top selector SHALL list Chat, Terminal, Changes and Files (Commits
  last) and follow the window's own width: labelled from 640px, icons below, and,
  when even the icons do not fit (always below 360px), one view menu in place of
  the tabs, drawn as the active view's tab. Choosing a view in that menu SHALL
  show it at once, as its tab does, and the window's ⋯ SHALL NOT list the views
  as a second menu. On a phone the Chat view
  SHALL show one composer and no terminal key bar. The Town master's chat, named
  by a setting, SHALL open docked on Chat once per visit on wide screens without
  focusing its pane. A table SHALL stand for its agent that needs the user (waiting, then
  finished) before the agent seated there. An agent opened this way, with either
  preference, SHALL walk back to its desk and stay there until its status
  changes, after which its status places it again; the tap SHALL NOT mark its
  completion reviewed. Tapping and dragging SHALL stay separate gestures:
  a tap never starts a move and a drag never opens a peek.

  Peek keyboard shortcuts SHALL apply only while keyboard focus is in the Town
  scene or in the peek; pointer hover alone SHALL NOT capture keys. In that context,
  digit keys SHALL choose the corresponding answer. Town SHALL NOT capture keys while a terminal, search field or other editable
  control has focus, during IME composition, or with Ctrl, Alt or Meta held, and a
  hover peek SHALL NOT change the keyboard target. Answers
  and replies SHALL be sent only to the exact qualified pane through the existing
  input path. If the target closes, moves away or its runtime generation retires,
  the peek SHALL close or show it as unavailable and SHALL NOT send input elsewhere.
  Opening the terminal from a peek SHALL follow the Inspector presentation preference.

#### Scenario: Choose a view in a narrow desktop window

- **WHEN** the user narrows an agent window on desktop until its tabs fold into
  the view menu and chooses Terminal, then Files, then Chat there
- **THEN** each view shows at once without widening the window, and widening it
  again brings the tabs back on the view last chosen

#### Scenario: Answer from a hover

- **WHEN** the user hovers a waiting agent whose pane exposes a permission choice and clicks Yes
- **THEN** exactly that pane receives the answer, the agent becomes working, and
  no other pane receives input

#### Scenario: A terminal has focus while another agent is hovered

- **WHEN** agent A's terminal has keyboard focus and the pointer hovers agent B so
  that B's peek opens, and the user types digits and letters
- **THEN** every key reaches only A's terminal and no answer is sent to B

#### Scenario: The target retires during a reply

- **WHEN** the peeked pane closes or its runtime generation retires before the reply is sent
- **THEN** World rejects the reply and does not redirect it to another pane, tab or host

#### Scenario: Tap the table of an agent waiting at reception

- **WHEN** Agents open names Chat and the user taps the table of an agent that is
  waiting at reception
- **THEN** that agent's window opens on Chat when its conversation exists (otherwise on Terminal under the startup rule), the agent walks back to its desk,
  and no terminal or peek card opens

#### Scenario: Board opens an agent on Chat

- **WHEN** Agents open names Chat and the user opens an agent's tab in Board
  whose harness Chat reads, then a plain shell's tab and an agent whose harness
  Chat cannot read
- **THEN** the first window opens on Chat when a conversation exists, otherwise on Terminal under the startup rule, and the other two open on their terminals

#### Scenario: Town opens Terminal

- **WHEN** the user sets Agents open to Terminal and taps the table of a
  finished agent waiting at reception
- **THEN** that agent's terminal opens, no peek opens, the agent walks back to
  its desk, and its completion is not marked reviewed

#### Scenario: No recognizable choice is on screen

- **WHEN** a blocked agent's latest lines contain neither a numbered menu nor a
  yes/no prompt
- **THEN** the peek offers Reply and the terminal without answer buttons
