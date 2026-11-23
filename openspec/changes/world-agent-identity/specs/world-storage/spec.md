## ADDED Requirements

### Requirement: Durable agent records and conversation history

World SHALL store each agent as an `agent` entity in the single-model entities table, its owned facts in the facts table, and its seat in `world_bindings`. Every conversation an agent has run SHALL be a row in `agent_conversations` with the agent ID, host, harness, conversation ID, first and last seen times, and source. The current conversation SHALL be one of those rows. Agent records and conversation history SHALL NOT be trimmed automatically. Each table and fact kind SHALL be listed in the storage catalog with its owner, identity and limit.

#### Scenario: Agent has many conversations
- **WHEN** an agent has run many conversations over months
- **THEN** every conversation remains in its history until the user removes it

#### Scenario: Ended agent
- **WHEN** an agent ends
- **THEN** its entity, facts and history remain readable and are not reused by a new agent

### Requirement: One store for agent and place appearance

World SHALL keep each agent's name, colour, look, status text and placement as fields of its agent entity, and each host's, room's and tab's own colour, spot and status text as fields of a place entity, in the single-model facts table. These SHALL replace the `board_colors` and `board_appearance` stores and the Town desk and room pin stores once their rows are copied. No view SHALL keep a second copy of these fields. Closing or losing a terminal SHALL NOT delete its colour, look or status text.

#### Scenario: Terminal closes
- **WHEN** an agent's terminal closes and the agent becomes away
- **THEN** its colour, look and status text stay on its record and show again when it is resumed

### Requirement: Lossless migration of agent facts

The upgrade SHALL add agent storage without changing existing rows, after the usual pre-upgrade snapshot. On each connection's first complete, unambiguous observation after the upgrade, World SHALL create an agent for each harness occupant and copy a tab colour, status text, avatar, Town desk pin and rank, Board card placement, interest, group membership, profile assignment or Town Master onto an agent only when its old key resolves to exactly one agent. Room and host colours and room spots SHALL be copied to their place records, and a tab colour whose tab holds no agent or several agents SHALL be copied to the tab's place record. Desk marks and residents SHALL gain an agent reference and keep their own lifetimes. A key that resolves to no agent or to several agents SHALL stay in place, keep working as before, and be copied once it resolves uniquely. Old rows SHALL stay. Each old table SHALL keep its reader while any of its rows is pending, and SHALL be retired by rename only after a check shows every one of its rows copied and none pending. Old rows SHALL never be deleted automatically, including by the cleanup of gone terminals.

#### Scenario: Colours keep their look
- **WHEN** the upgrade copies tab, room and host colours
- **THEN** every tab, desk and card shows the same colour as before the upgrade

#### Scenario: Tab with two agents
- **WHEN** a pinned tab holds two agents at the first observation
- **THEN** the tab pin stays on the tab, neither agent gets it, and the Town shows the pin as before; the tab's colour moves to the tab's place record and both agents still show it

#### Scenario: Host offline during upgrade
- **WHEN** a host is offline at the first start after the upgrade
- **THEN** its facts stay pending and are copied after its first complete observation

#### Scenario: Pending rows block retirement
- **WHEN** the retirement check runs while an old table still holds a pending row
- **THEN** that table and its reader stay in place, and the pending row keeps working and can still be copied later

#### Scenario: Rollback
- **WHEN** the user rolls back to the previous release
- **THEN** the named pre-upgrade snapshot restores every old row unchanged
