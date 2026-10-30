## ADDED Requirements

### Requirement: Per-terminal settings live with the terminal

**Where they live.** A terminal's profile assignment and the Town master role SHALL be
kept in Herdr metadata on that terminal's pane, not in World's files. Every World
connected to that Herdr SHALL then read the same settings, and the settings SHALL end
when the terminal ends, including on a Herdr restart.

**Token rules.** World SHALL write these settings as namespaced tokens that:
- name the terminal they were written for;
- stay within Herdr's per-terminal token limits;
- carry no TTL.

World SHALL honour the tokens only while the pane holds that terminal.

**Writes.** World SHALL write only through the exact connection's current runtime
lease. It SHALL first confirm that the pane still holds the expected terminal, and
SHALL revalidate the lease after writing. A failed write SHALL be shown and SHALL NOT
be reported as saved. After a move World performs, it SHALL keep the settings on the
moved terminal.

**Unreachable hosts.** A host that is unreachable or stale SHALL leave its terminals'
settings unresolved, never cleared.

**Profiles.** Profiles and chimes SHALL stay owned by each World.
- A shared assignment SHALL resolve against this World's profiles.
- An assignment naming a profile this World lacks SHALL show the recorded profile name
  with the default look.

**Town master.** At most one agent SHALL hold the Town master role across every host a
World observes.
- A new claim SHALL carry a revision one higher than any current claim the assigning
  World observes.
- The highest revision SHALL win; a tie SHALL go to the greater terminal ID.
- World SHALL clear superseded claims where it holds a current lease.
- Moving the role away from another live agent SHALL still ask the owner first.

**Migration.** World SHALL import each existing assignment once, when its connection is
first observed complete on a ready runtime after this change. It SHALL drop an
assignment whose terminal is absent from that observation, and SHALL keep the
assignments of hosts not yet observed until they are.

#### Scenario: Two Worlds share one Herdr
- **WHEN** the owner launches an agent from a profile in one World while another World
  observes the same Herdr
- **THEN** both Worlds show that terminal's assignment, and the second World uses its
  own profile of that ID or, without one, the recorded name with the default look

#### Scenario: Herdr restarts
- **WHEN** Herdr restarts and restores its panes with new terminals
- **THEN** no restored pane carries the old assignment or Town master role

#### Scenario: Pane moved by World
- **WHEN** World moves an agent's pane to another desk
- **THEN** the terminal keeps its assignment and role under its new pane ID

#### Scenario: Host offline
- **WHEN** a host holding the Town master goes offline
- **THEN** World keeps that claim unresolved, does not clear it, and resolves it again
  when the host returns

#### Scenario: Town master assigned in two Worlds
- **WHEN** two Worlds assign the role to different agents and each then observes both
  claims
- **THEN** both Worlds show the same holder, decided by revision and then terminal ID,
  and the superseded claim is cleared

#### Scenario: Write fails
- **WHEN** Herdr refuses the token write or the runtime retires during it
- **THEN** World shows the failure, does not show the setting as saved, and leaves the
  previous setting in place
