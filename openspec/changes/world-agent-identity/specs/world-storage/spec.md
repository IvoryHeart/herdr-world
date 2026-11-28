## ADDED Requirements

### Requirement: Durable agent records and conversation history

World SHALL store each agent as an `agent` entity in the single-model `entities` table, its fields in the `facts` table, and its seat in `world_bindings`. Each field SHALL have one owner, declared once in the storage catalog: `world` for a value World owns, or the observing adapter for a last-known value World keeps; rows SHALL NOT carry an owner of their own. Agent IDs SHALL belong to one World instance. These two tables SHALL be the only tables the agent record adds.

#### Scenario: Conversation storage and retention

- **WHEN** World stores agent records or conversation history
- **THEN** Every conversation an agent has run SHALL be one item of the agent's `conversation` fact, keyed by harness and conversation ID, with its host, first and last seen times and source. The current conversation SHALL name one of those items. Agent records and conversation history SHALL NOT be trimmed automatically. Each table and fact kind SHALL be listed in the storage catalog with its owner, identity and limit.

#### Scenario: Agent has many conversations
- **WHEN** an agent has run many conversations over months
- **THEN** every conversation remains in its history until the user removes it

#### Scenario: Ended agent
- **WHEN** an agent ends
- **THEN** its entity, facts and history remain readable and are not reused by a new agent

### Requirement: Agent record writers and history

Only the World command executor (World-owned fields and End) and the agent resolver (observed fields and new agents) SHALL write agent records. Only commands SHALL record history entries; an observed label or conversation update SHALL record none.

#### Scenario: Observed rename
- **WHEN** the runtime reports a new folder or a new conversation for an agent
- **THEN** the resolver updates the observed fields and no history entry is written

### Requirement: One store for agent and place appearance

World SHALL keep each agent's name, colour, look, status text and placement as fields of its agent entity, and each host's, room's and tab's own colour, spot and status text as fields of a place entity, in the single-model facts table. These SHALL replace the `board_colors` and `board_appearance` stores and the Town desk and room pin stores once their rows are copied. No view SHALL keep a second copy of these fields.

#### Scenario: Terminal closes
- **WHEN** an agent's terminal closes and the agent becomes away
- **THEN** its colour, look and status text stay on its record and show again when it is resumed

### Requirement: Closing hides appearance instead of deleting it

Closing or losing a terminal, or closing a tab, SHALL NOT delete its colour, look, status text or desk pin. The row SHALL move, in its own table, to a closed key that no live key can take, SHALL be hidden from every view, SHALL NOT count toward the layout or appearance limits, and SHALL NOT be trimmed. A reused tab or pane ID SHALL NOT show or overwrite it.

#### Scenario: Reused tab ID
- **WHEN** a tab with a chosen colour closes and a new tab later gets the same native ID
- **THEN** the old colour row is kept under its closed key, hidden, and not shown on the new tab

#### Scenario: Recoloured after reuse
- **WHEN** a coloured, pinned tab closes, a new tab gets the same native ID, and the user colours and pins the new tab
- **THEN** the new tab's colour and pin are stored as new live rows and the closed rows keep their old values

### Requirement: Lossless migration of agent facts

The upgrade SHALL add agent storage without changing existing rows, after the usual pre-upgrade snapshot.

#### Scenario: Migration evidence and retained rows

- **WHEN** World migrates existing agent facts
- **THEN** On each connection's first complete, unambiguous observation after the upgrade, World SHALL create an agent for each harness occupant and copy a tab colour, status text, avatar, Town desk pin and rank, Board card placement, interest, group membership, profile assignment or Town Master onto an agent only when its old key resolves to exactly one agent. Room and host colours and room spots SHALL be copied to their place records, and a tab colour whose tab holds no agent or several agents SHALL be copied to the tab's place record. Desk marks and residents SHALL gain an agent reference and keep their own lifetimes. A key that resolves to no agent or to several agents SHALL stay in place, keep working as before, and be copied once it resolves uniquely. Old rows SHALL stay. Each old table SHALL keep its reader while any of its rows is pending, and SHALL be retired by rename only after a check shows every one of its rows copied and none pending. Old rows SHALL never be deleted automatically, including by the cleanup of gone terminals.

#### Scenario: Colours keep their look
- **WHEN** the upgrade copies tab, room and host colours
- **THEN** every tab, desk and card shows the same colour as before the upgrade

#### Scenario: Tab with two agents
- **WHEN** a pinned tab holds two agents at the first observation
- **THEN** the tab pin stays on the tab, neither agent gets it, and the Town shows the pin as before; the tab's colour moves to the tab's place record and both agents still show it

#### Scenario: Chosen tab colour beats inherited colour
- **WHEN** a tab with a chosen red colour holds two agents, and one of them was spawned by an agent whose colour is green
- **THEN** after the upgrade both agents still show red, because the tab's place colour comes before the inherited colour

#### Scenario: Host offline during upgrade
- **WHEN** a host is offline at the first start after the upgrade
- **THEN** its facts stay pending and are copied after its first complete observation

#### Scenario: Pending rows block retirement
- **WHEN** the retirement check runs while an old table still holds a pending row
- **THEN** that table and its reader stay in place, and the pending row keeps working and can still be copied later

#### Scenario: Rollback
- **WHEN** the user rolls back to the previous release
- **THEN** the older release refuses the newer `world.sqlite` and names the pre-upgrade snapshot, which restores every old row unchanged; the newer file stays beside it

#### Scenario: Rolling back a retirement
- **WHEN** a release that retired a table is rolled back
- **THEN** its `retired_*` tables are renamed back to their names and every row is where the older release left it
