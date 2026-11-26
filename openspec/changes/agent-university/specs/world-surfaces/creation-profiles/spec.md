## ADDED Requirements

### Requirement: Agent profile lifecycle

World SHALL let the operator create, edit, copy, retire, restore and delete
agent profiles in one University window, reachable from every view.

#### Scenario: Agent profile lifecycle acceptance rules

- **WHEN** World presents or operates agent profiles
- **THEN** a save that changes a profile SHALL give it a new version; Copy SHALL
  create a new profile with a new ID and version 1 that is never a starter;
  copying to another college or changing a profile's college SHALL first list
  every skill and MCP server the target college lacks and every choice that
  resets to that harness's default; a retired profile SHALL be offered by no
  hiring list (University, town center, Board, Actions, Spaces, launcher, CLI)
  and SHALL be restorable; Delete SHALL be offered only for a retired profile
  and SHALL name the agents still working from it; no lifecycle action SHALL
  stop, restart or change a running agent

#### Scenario: Edit a profile with agents running from it

- **WHEN** two agents are running from Reviewer version 3 and the user saves a
  new model for Reviewer
- **THEN** Reviewer is version 4, both agents keep running with what they were
  launched with, and each one's character sheet says it was hired from version
  3 and shows what changed

#### Scenario: Retire a starter

- **WHEN** the user retires the Builder starter and reloads World
- **THEN** Builder is on the University's Retired shelf, no launcher offers it,
  and World does not seed it again

### Requirement: Colleges and their catalogs

World SHALL present one college per harness that it starts or that a
connected host reports. For each host a college SHALL show the harness's
readiness, the skills and MCP servers that harness can see there, and the
model, effort and permission choices World offers for it.

#### Scenario: Colleges and their catalogs acceptance rules

- **WHEN** World reads a college's catalog for a room on a host
- **THEN** it SHALL read on that room's own connection and runtime generation,
  locally or over its OpenSSH destination, within a bound, without falling back
  to another connection; skills SHALL be the `SKILL.md` folders in that
  harness's own skill folders for the room's folder and user; MCP servers SHALL
  come from that harness's own configuration or read-only listing, and World
  SHALL NOT start a server to list it; only a skill's name and origin and an MCP
  server's name, transport, scope and enabled state SHALL leave the host; the
  catalog SHALL NOT be stored; a failed read SHALL show the last result as stale
  and SHALL NOT be used to admit a hire; Windows hosts SHALL report not checked;
  a harness without a launch mapping SHALL say that World cannot attach skills
  or MCP servers to it

#### Scenario: A skill only Codex can see

- **WHEN** a host has a skill only in Codex's user skill folder
- **THEN** the Codex college lists it, the Claude Code college does not, and a
  Claude Code profile cannot attach it

#### Scenario: MCP configuration holds a token

- **WHEN** a host's Claude configuration defines an MCP server with a token in
  its environment
- **THEN** the college shows only the server's name, transport, scope and
  enabled state, and neither the service nor any browser receives the token

### Requirement: Skills and MCP servers attached at launch

A hire from a profile SHALL attach exactly that profile's skills and MCP
servers through the harness's own launch options, without changing the user's
harness configuration.

#### Scenario: Skills and MCP servers attached at launch acceptance rules

- **WHEN** `launcher.start` starts an agent from a profile with attached skills
  or MCP servers
- **THEN** it SHALL first read the destination host's catalog on the captured
  connection and generation; if any attached item is missing or the host cannot
  be checked, it SHALL refuse before creating a tab, naming each missing item
  and the folders or configuration it looked in, and SHALL offer Edit profile,
  the college and another room but no partial hire; for Claude Code it SHALL
  pass the attached skills in the inline subagent definition and the attached
  MCP servers with `--mcp-config` and `--strict-mcp-config`; for Codex it SHALL
  enable the attached MCP servers and disable every other catalogued server
  with per-launch configuration overrides, and name the attached skills in its
  developer instructions; any per-launch file World writes SHALL be on the
  agent's host, owner-only, outside the harness's own configuration files
  except a World-named marked file, and removed when its terminal ends; MCP
  definitions SHALL NOT pass through the World service or a browser

#### Scenario: Hire on a host without an attached MCP server

- **WHEN** the user hires a Codex profile that attaches the MCP server `github`
  into a room on a host whose Codex has no `github` server
- **THEN** World starts nothing and says that Codex on that host has no MCP
  server `github`

#### Scenario: Claude agent gets only its MCP servers

- **WHEN** the user hires a Claude Code profile attaching one of the three MCP
  servers in the user's Claude configuration
- **THEN** the agent has only that server, and the user's Claude configuration
  files are unchanged

### Requirement: What a hired agent was given

At a confirmed start from a profile, World SHALL record what the agent was
given and show it for as long as the agent's terminal lives.

#### Scenario: What a hired agent was given acceptance rules

- **WHEN** an agent hired from a profile is shown on its character sheet,
  Inspector, the University or `herdr-world profile show`
- **THEN** World SHALL show the profile's ID, name and version; the harness
  options passed; each attached skill and MCP server with its origin and
  whether it was the only set, loaded at start, or available and named; the
  other skills and MCP servers the harness could still find on that host; and
  the host, room and time; the record SHALL end with the terminal; a later edit,
  retire or delete of the profile SHALL NOT change it

### Requirement: Operator-only profile attachments

Creating a profile, or changing its harness, skills, MCP servers, tools or
permission, SHALL be an operator-only action.

#### Scenario: Operator-only profile attachments acceptance rules

- **WHEN** an agent-originated call or a caller holding only the `world`
  capability saves a new profile or changes one of those fields
- **THEN** admission SHALL refuse it before the profile store is written, and
  reads and other edits SHALL keep their current admission

#### Scenario: An agent tries to add an MCP server to its profile

- **WHEN** an agent runs a World command that saves its own profile with an
  added MCP server
- **THEN** World refuses it and the profile is unchanged
