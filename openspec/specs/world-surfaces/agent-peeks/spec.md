# World agent peeks

## Purpose

Define the user-facing agent peeks contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

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
  last) and follow the window's own width: labelled from 640px, icons below, and
  below 360px the active view with the others under ⋯. On a phone the Chat view
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

### Requirement: Town peeks show recent chatter and take replies

An agent's peek SHALL show the agent's latest message from the conversation
read model that the Inspector's Chat reads (`agent_conversation.latest` for the
exact qualified pane), rendered as Chat renders it, and SHALL reread it when the
service reports the conversation changed, sharing Chat's watch rather than
polling.

#### Scenario: Town peeks show recent chatter and take replies acceptance rules

- **WHEN** World presents agent peeks or opens their resources
- **THEN** It SHALL NOT show terminal
  screen text as the message; when the conversation is unavailable it SHALL show
  Chat's reason. A waiting agent's question, read from the pane's latest lines,
  SHALL be set apart below the message, with its answers as one-tap buttons. The
  peek is a read-only preview: it SHALL have no reply line and no attachments of
  its own, and its Open chat (Follow up for a finished agent) SHALL open the
  agent's window on Chat. The peek's Open terminal action SHALL open the pane's
  full terminal. Attaching files in the phone composer, Spaces or Chat SHALL show
  one chip per file: uploading with byte progress where the
  transport reports it, then done or failed, with Retry and Remove for a failed
  file; picking a failed file again SHALL retry it. Send SHALL wait for uploads,
  and a file picked again while it uploads SHALL NOT be uploaded twice. A path
  whose upload finishes after its composer closed SHALL be kept for that pane and
  join the draft of the next composer opened for it; a chip SHALL NOT show done
  for a path that can no longer reach a draft. The peek's Inspector action SHALL open World's Inspector
  on the agent's Files view, from which Changes and History are one tap away,
  using the same path as the shell's Actions menu. Answers and replies SHALL be
  sent only to the exact qualified pane, and the result SHALL be confirmed by a
  short notice; a finished agent SHALL announce itself once.

#### Scenario: Reply from the peek

- **WHEN** the user chooses Open chat in an agent's peek
- **THEN** the agent's window opens on Chat, where the reply is written; the
  peek offers no reply line or attachments of its own

#### Scenario: The peek renders the latest message

- **WHEN** an agent's latest message contains a Markdown table
- **THEN** the peek shows a table, not the message's pipes

#### Scenario: An upload fails

- **WHEN** a file attached in a composer fails to upload
- **THEN** its chip says it failed and why, Retry uploads it again, and Send is
  not blocked by the failed file

#### Scenario: Open the Inspector from a peek

- **WHEN** the user taps Inspector in an agent's peek
- **THEN** World's Inspector opens on that agent's Files view
