## ADDED Requirements

### Requirement: Per-terminal settings live with the terminal

**Where they live.** A terminal's profile assignment and the Town master role SHALL be
kept in Herdr metadata reported on that terminal's pane, not in World's files. Every
World connected to that Herdr SHALL then read the same settings, and the settings SHALL
end when the terminal ends, including on a Herdr restart.

**Token rules.** World SHALL write these settings as namespaced tokens that:
- name the terminal they were written for;
- stay within Herdr's per-terminal token limits;
- carry no TTL.

World SHALL honour the tokens only while the pane holds that terminal. Before writing,
World SHALL check that every value is non-empty, trimmed, free of control characters and
within Herdr's value length, so that Herdr never silently changes it.

**Writes.** World SHALL write only through the exact connection's current runtime
lease. It SHALL first confirm that the pane still holds the expected terminal, and
SHALL revalidate the lease after writing. A failed or refused write SHALL be shown and
SHALL NOT be reported as saved. After a move World performs, it SHALL keep the settings
on the moved terminal.

**Unreachable hosts.** A host that is unreachable or stale SHALL leave its terminals'
settings unresolved, never cleared.

**Profiles.** Profiles and chimes SHALL stay owned by each World.
- A shared assignment SHALL resolve against this World's profiles.
- An assignment naming a profile this World lacks SHALL show the recorded profile name
  with the default look.

**Town master.** At most one agent SHALL hold the Town master role across every host a
World observes, and the newest assignment SHALL win.
- A new claim's revision SHALL be the later of the current wall time and one more than
  the highest revision that World has observed or written. World SHALL remember that
  highest revision across its restarts.
- The claim with the highest revision SHALL win; a tie SHALL go to the greater terminal
  ID.
- World SHALL clear superseded claims where it holds a current lease.
- Moving the role away from another live agent SHALL still ask the owner first.

**Migration.** World SHALL import each existing assignment once, when its connection is
first observed complete on a ready runtime after this change. It SHALL:
- drop an assignment whose terminal is absent from that observation;
- keep the assignments of hosts not yet observed until they are;
- record per connection that the import is done, so that no later start imports it
  again.

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
- **WHEN** a host holding the Town master goes offline and nothing else changes
- **THEN** World keeps that claim unresolved, does not clear it, and resolves it again
  when the host returns

#### Scenario: The offline holder returns after a newer assignment
- **WHEN** the owner gives the role to an agent on another host while the previous
  holder's host is offline, and that host later returns
- **THEN** the newer assignment keeps the role, and the returning claim is cleared as
  superseded

#### Scenario: World restarted while the holder was offline
- **WHEN** World restarts while the holder's host is offline, and the owner then assigns
  the role to another agent before that host returns
- **THEN** the new assignment wins when the host returns, because its revision is newer

#### Scenario: Town master assigned in two Worlds
- **WHEN** two Worlds assign the role to different agents and each then observes both
  claims
- **THEN** both Worlds show the same holder, decided by revision and then terminal ID,
  and the superseded claim is cleared

#### Scenario: A value Herdr would change
- **WHEN** a profile name contains control characters or is longer than Herdr keeps
- **THEN** World writes a cleaned, shortened name it has validated, never a value Herdr
  would silently truncate

#### Scenario: Restart after a newer assignment
- **WHEN** World restarts after an imported assignment was replaced through the tokens
- **THEN** World does not import the legacy assignment again, and the newer assignment
  stays

#### Scenario: Write fails
- **WHEN** Herdr refuses the token write, including past its per-terminal key limit, or
  the runtime retires during it
- **THEN** World shows the failure, does not show the setting as saved, and leaves the
  previous setting in place
