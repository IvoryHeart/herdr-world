## MODIFIED Requirements

### Requirement: Board notes and strings

The user SHALL be able to create a note by double-click or double-tap on empty
board or from a card, and edit, colour and delete it. Notes SHALL belong to the whole board. The user SHALL be able to
string a note or card to another card by dragging from a card's handle or with
String to…, and to cut a string from the string itself or from the panel.
Dragging a handle onto empty board SHALL create a note strung to that card.
Stringing to a tab with more than one pane SHALL ask which pane; a single-pane
tab SHALL select its pane. A string to a tab or workspace SHALL be context only.

A note strung to an agent's pane SHALL offer to send the note to that agent.
The note text SHALL be delivered as a prompt to that exact pane only when the
user chooses Send, and only after World revalidates that the string is
attached on the current runtime generation and that the agent the note was
strung to is present on that pane; otherwise Send SHALL be refused with its
reason.

When a note is strung to a pane, the browser SHALL tell the service which agent
it showed there (its kind and Herdr session), and the service SHALL record that
agent as the string's recipient (kind, hashed session and foreground process
group) only if its own read of the pane finds the same kind and session. A
string whose agent could not be confirmed that way (no session shown, a
replacement before the read, no answer) SHALL stay unbound. Only the service
SHALL set a recipient, qualified by the anchor's connection, pane and terminal;
a re-witnessed anchor (after Herdr restarts) SHALL drop it. At Send the service SHALL compare the pane's agent
with the recipient: they are the same agent when their kinds match and their
sessions match, or, when either has no session, their process groups match.
Another agent in the same pane and terminal, or a string whose recipient was
never recorded, SHALL be refused with that agent named, and the note SHALL go
to it only when the user confirms that agent; the confirmed agent becomes the
string's recipient. Herdr cannot hold a pane between a check and the prompt, so
the service SHALL read the pane's agent again after the prompt and report a
change as possibly delivered to another agent, never as sent. A note SHALL offer to
start a new agent, from a profile or an agent kind, in a chosen workspace
through the shared launcher (see New agent from a profile or a kind), with the
note as its first prompt, and SHALL string the note to the new pane whenever
one was created. Agent replies or results MAY be
shown on the note when they are reported; World SHALL NOT invent them.

#### Scenario: Send a note

- **WHEN** a note is strung to an agent's pane and the user chooses Send
- **THEN** the agent in that pane receives the note text as a prompt, and nothing is sent to any other pane

#### Scenario: Another agent in the same pane

- **WHEN** a note was strung to agent A, A exits and agent B starts in the same shell, keeping the pane and terminal, and the user chooses Send
- **THEN** nothing is sent; World says B is now in that pane and offers to send to B, and sends to B only if the user chooses that

#### Scenario: The agent changes during Send

- **WHEN** the pane's agent is replaced between the service's last check and the prompt
- **THEN** World reports that the note may have reached another agent and does not report it as sent

#### Scenario: String to a tab with two agents

- **WHEN** the user drags a note's string onto a tab with two agent panes
- **THEN** World asks which pane, and the string attaches to the chosen pane

#### Scenario: A new agent is slow to start

- **WHEN** the user starts an agent from a note and it is not interactive within the bound
- **THEN** World reports that the agent may still be starting and that the note was not sent, and offers Send

#### Scenario: Cut a string

- **WHEN** the user selects a string and chooses Cut string
- **THEN** the string is removed and the note and card stay where they are

## ADDED Requirements

### Requirement: Agent profiles

The World service SHALL keep agent profiles: a name, an agent kind (the
harness), an optional model, reasoning effort and permission mode, a role,
skills, tools, a starting brief, whether to send the brief once the agent is
ready, an optional home room, an optional terminal colour and a Town look
(skin, hair and its style, outfit, shirt and trouser colours, accessory).
Profiles SHALL be bounded, validated, revisioned and written atomically with
owner-only permissions, and SHALL be shared by every authenticated browser of
the service. A profile SHALL NOT hold credentials: text that looks like a key
or token SHALL be refused. World SHALL seed editable starter profiles (Reviewer,
Builder, Designer, FirstMate) once; deleting one SHALL NOT bring it back.

The profile editor SHALL be reachable from World settings, the Actions menu, the launcher and Board, show
a live preview of the look with Town's sprites and the exact launch the profile
maps to. At launch World SHALL map a profile to its harness's own configuration:
for Claude Code an inline subagent definition (description, prompt, tools,
model, skills) selected as the session's agent, and its permission mode; for
Codex its model, approval policy, sandbox (writable when the tools include Edit
or Write), reasoning effort and the role and skills as developer instructions;
for any other kind no options, with the role sent ahead of the first prompt.
An empty choice SHALL leave the harness's default.

#### Scenario: Edit a starter

- **WHEN** the user changes the Builder starter's model and saves
- **THEN** every browser of the service shows the change and Builder is still marked as a starter

#### Scenario: A credential in a profile

- **WHEN** the user saves a profile whose role contains an API key
- **THEN** the service refuses the profile and nothing is written

#### Scenario: Launch a Codex profile

- **WHEN** the user starts the Reviewer profile (Codex, high effort, read-only tools)
- **THEN** Codex starts with its approval policy, a read-only sandbox, high reasoning effort and the role as developer instructions

### Requirement: New agent from a profile or a kind

The shell's Actions menu in the visual views, each actionable Town room
(including on phones), Spaces (beside New tab) and Board's New tab dialog SHALL
offer New agent; like other view actions, it SHALL NOT add buttons to a view's
toolbar. It SHALL name a destination room on a
ready host and start, in one tap, a profile or an agent kind. The kinds SHALL be
those the host's Herdr reports as supported (its agent manifests); a Herdr that
reports none SHALL be offered Claude and Codex, and Herdr SHALL validate the
choice.

Through the room's own connection and runtime generation, the service SHALL
create a tab labelled with the profile or kind, start the agent in its root
pane under a Herdr agent name derived from the label and unused on that host,
wait within a bound until that same agent in that pane and terminal is
interactive, then send the first prompt once. When Herdr refuses the start
because the new shell is not yet at its prompt or the name is taken, nothing
has started, and the service SHALL retry the start within a bound. Any other
refusal SHALL fail with Herdr's reason. A lost start reply SHALL be inspected,
never relaunched. An agent that stops on a question before it is ready, or that
exits as it starts (the shell is back in the foreground), SHALL be reported at
once without a prompt; a timeout SHALL be reported as uncertain. Every outcome
SHALL say what was created and offer to open it. A ready agent SHALL open in a
terminal window. A launch from a profile SHALL give the new tab the profile's
colour, and Town SHALL draw that agent with the profile's look; other agents
keep the look derived from their identity.

#### Scenario: Start Claude in a new tab

- **WHEN** the user chooses Claude in New agent for a room whose new shell takes a moment to reach its prompt
- **THEN** Claude starts in the new tab once the shell is ready, rather than leaving a plain shell

#### Scenario: A harness refuses its options

- **WHEN** a harness exits as it starts because it rejects an option
- **THEN** World reports that the agent exited, without waiting for the timeout, and offers to open the tab

#### Scenario: A question before the agent is ready

- **WHEN** the new agent asks whether to trust its folder
- **THEN** World reports that the agent is waiting on a question, sends nothing and offers to open the tab

### Requirement: Harness readiness

For each agent kind a host supports, the service SHALL report whether the
harness is installed (on the service's PATH or a usual install folder) and, when
the harness has a status command World can read, whether it is logged in and by
which method. It SHALL run the harness's own status command on the room's host
(locally or over the connection's OpenSSH destination) and keep only those
fields; it SHALL NOT read credentials or forward the command's output. Harness
commands SHALL be data per harness, not logic. The launcher and the profile
editor SHALL show a missing or logged-out harness, and SHALL offer Log in, which
opens a new tab in the room and shows the harness's own fixed login command,
with Copy and Open its tab, for the user to run there and complete; World SHALL
then re-check on request. The login command SHALL find the executable by the
same lookup readiness uses on that host. World SHALL NOT type into the login
tab: Herdr reports no prompt state, and a startup script reading a key would
take typed text as its answer. Windows hosts
SHALL NOT be probed; they SHALL report no readiness, which blocks no kind their
Herdr supports.

#### Scenario: Logged out

- **WHEN** Codex is installed on a host and reports that it is not logged in
- **THEN** New agent says Codex is logged out there and offers Log in, which opens a tab running Codex's own login

#### Scenario: Status names the account

- **WHEN** a harness's status output includes the account's email address
- **THEN** World reports only whether it is logged in and the method, never the address

#### Scenario: A startup question in the login tab

- **WHEN** the user chooses Log in and the new tab's startup script waits for a single key
- **THEN** World has typed nothing there; the user sees the question, answers it and then runs the login command shown in New agent

#### Scenario: A Windows host

- **WHEN** New agent targets a room on a Windows host whose Herdr supports Claude
- **THEN** World does not probe the host and still offers Claude
