## ADDED Requirements

### Requirement: World agent identity

World SHALL give each Claude Code or Codex occupant it observes one agent record with a store-issued `a-` World ID. The ID SHALL be immutable and never reused. Names, folders and harness kinds SHALL be labels and claims, never identity. An agent SHALL be live, away, unresolved or ended. It SHALL keep its ID across renames, moves between rooms or desks, World restarts, new conversations in its own terminal, and moves or resumes that World performs. It SHALL end only when the user ends it, or when it is away with no seat and no known conversation. An ended agent SHALL never return automatically, and its record SHALL be kept.

#### Scenario: Renamed and moved in Herdr
- **WHEN** a live agent's pane is renamed and moved to another tab, and a complete listing still witnesses its terminal
- **THEN** it keeps its agent ID, facts and conversation, and only its labels and evidence change

#### Scenario: World restarts
- **WHEN** World starts again before any connection has been observed
- **THEN** every saved agent is unresolved, keeps its facts, and becomes live again only on the witnessed terminal

#### Scenario: Another harness takes the terminal
- **WHEN** a Codex agent's terminal later runs Claude Code
- **THEN** the Codex agent becomes away and the Claude Code occupant gets a new agent

#### Scenario: Terminal closes with nothing to resume
- **WHEN** an agent's terminal closes while its conversation is unknown or empty
- **THEN** the agent ends, and it is not restored by a later terminal with the same name or folder

### Requirement: Agent seat binding and same-agent evidence

An agent's place SHALL be a `seat` binding under verified source bindings, with the connection ID, witnessed terminal and harness kind as evidence. Pane, tab and room IDs SHALL be evidence only. An observation SHALL be the same agent only through the witnessed terminal in a current, complete listing of the same runtime, through World's own move or resume result naming the terminal, or through the user's confirmation. A conversation resumed in a terminal World did not start SHALL produce a new agent and an offer to confirm it as the earlier agent. It SHALL NOT be merged automatically. One terminal SHALL hold at most one agent.

#### Scenario: World resumes an agent after a runtime restart
- **WHEN** a runtime restart leaves an agent away and World resumes its conversation in a new terminal
- **THEN** World's resume result binds the same agent to the new terminal

#### Scenario: Conversation resumed by hand
- **WHEN** the user resumes an away agent's conversation in a terminal World did not start
- **THEN** the occupant is a new agent, World offers "Same agent as" the earlier agent, and only the user's confirmation binds the earlier agent and retires the new one

#### Scenario: Same name, different terminals
- **WHEN** two terminals run agents with the same label
- **THEN** they are two agents with two IDs

### Requirement: Agent ambiguity binds nothing

World SHALL NOT attach, move or end an agent's seat on ambiguous evidence. A partial, stale or failed listing, a terminal listed twice, or one conversation claimed by two live terminals SHALL leave the agents involved unresolved or in conflict, with their seats, facts and conversations unchanged. Reused pane IDs, names, folders and runtime generations SHALL never prove continuity. An agent that is unresolved, or whose conversation is unknown or in conflict, SHALL NOT authorize actions that need its conversation.

#### Scenario: Duplicate terminal in one listing
- **WHEN** one runtime listing names a witnessed terminal twice
- **THEN** no agent binds to either copy and both stay unresolved until a clean listing

#### Scenario: One Claude conversation in two terminals
- **WHEN** two live Claude processes report the same conversation
- **THEN** that conversation is in conflict for both agents, nothing merges, and resume and move refuse with the reason

#### Scenario: Host offline
- **WHEN** a connection's host stops answering
- **THEN** its agents become unresolved with cached labels, and none of them ends

### Requirement: Agent conversation claim

Each agent SHALL have a declared conversation field with per-field claims. Only a source naming the foreground process's own conversation SHALL set it, in this order: the harness's per-process record (Claude Code `sessions/<pid>.json` fenced by the process start time; the Codex thread lock that the process holds, excluding sub-agent threads), Herdr's harness report, the launch argument until the record is read, and the user's link in Chat. This SHALL apply on Herdr TUI and herdr-core, locally and over a connection's SSH read path. Titles, transcript inference and folder recency SHALL NOT set it. The conversation SHALL be known, empty, unknown with a reason, or in conflict. World SHALL re-read it when the runtime reports a change for the terminal and otherwise at most every 5 seconds per process. A new conversation in the same seat SHALL become current, and the previous one SHALL stay in the agent's history.

#### Scenario: Codex agent that has not spoken yet
- **WHEN** a Codex process holds one thread lock and its thread has no saved turn
- **THEN** the agent's conversation is empty with that thread ID, and starting fresh loses nothing

#### Scenario: Claude agent on Herdr TUI without a hook report
- **WHEN** Herdr reports no session for a Claude pane but the pane's foreground process has a Claude process record with a matching start time
- **THEN** the agent's conversation is known from that record

#### Scenario: New conversation in place
- **WHEN** a live agent's process record names a different conversation after `/clear`
- **THEN** the agent keeps its ID, the new conversation becomes current, and the earlier one remains in its history

#### Scenario: Conversation cannot be read
- **WHEN** a host cannot be read, the process changed during the read, or a process holds more than one main thread lock
- **THEN** the conversation is unknown with that reason, and actions that need it refuse and show the reason

#### Scenario: Sources disagree
- **WHEN** Herdr's harness report and the process record name different conversations
- **THEN** the conversation is in conflict, shows both sources, and authorizes nothing until they agree

### Requirement: One agent record for every view

The World snapshot SHALL carry one entry per agent ID with its label, harness, state, conversation state and source or reason, seat, and facts, and SHALL carry `agent_id` on each terminal row it attributes, all under one revision. Town, Desk and Board SHALL select agents by `agent_id`, SHALL NOT decide which agent a terminal is, and SHALL change agent facts only through agent operations.

#### Scenario: Three views, one agent
- **WHEN** Town, Desk and Board render from the same snapshot
- **THEN** each agent appears once per view, with the same label, conversation state, pin and colour

#### Scenario: Pin set in Town
- **WHEN** the user pins an agent's desk in Town
- **THEN** the pin is an agent fact, and Desk and Board read the same value at the next revision
