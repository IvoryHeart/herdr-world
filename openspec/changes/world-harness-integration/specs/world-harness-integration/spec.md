## ADDED Requirements

### Requirement: World integration packages per harness

World SHALL ship one integration package per supported harness as part of each
World release. A package SHALL consist of World-owned files in World's
integration folder on the host, registered with the harness's own plugin
commands where the harness has them, or as one World-named file in a folder the
harness loads whole. Every package SHALL carry a positive integer version and
the World release that produced it, and SHALL be named so World and the user can
tell it apart from their own and Herdr's entries. A package SHALL NOT include
credentials, the user's settings values, or anything specific to one user or
host, and SHALL NOT set or replace a harness setting the user owns, such as
Claude Code's `statusLine`.

#### Scenario: Package visible in the harness
- **WHEN** World's Claude Code package is installed on a host
- **THEN** `claude plugin list` on that host shows the `herdr-world` plugin from
  World's local marketplace, and the user's `statusLine` and hook entries are
  unchanged

#### Scenario: Harness not installed or too old
- **WHEN** a host has no executable for a harness, or a version without the
  capability the package needs
- **THEN** World reports that harness as `harness_missing` or `unsupported` and
  installs nothing for it

### Requirement: Explicit per-host lifecycle

World SHALL install, update and remove a package only through a host's qualified
local or SSH connection, with a self-contained program that runs on that host,
and never through another connection. The first installation of a package on a
host SHALL be an explicit operator action from Settings or the CLI; an
agent-originated verb SHALL NOT install, update or remove a package. Before
writing, World SHALL show every file it will create, every harness command it
will run and every configuration entry it will add. After a package is
installed, an explicit World update or Herdr upgrade SHALL refresh it to the
release's version and SHALL NOT install packages that are not already installed.
Each operation SHALL report `installed`, `updated`, `current`, `removed`,
`skipped` or `failed` with a short reason, per harness and host.

#### Scenario: Install on an SSH host
- **WHEN** the operator installs the Claude Code package on an SSH host
- **THEN** the installer runs only through that host's qualified connection,
  changes only that host, and reports the outcome for that host

#### Scenario: World update with packages installed
- **WHEN** an explicit World update runs on a host that has an older Claude Code
  package and no Codex package
- **THEN** the Claude Code package is updated and Codex stays not installed

#### Scenario: Connection lost during install
- **WHEN** the connection fails while the installer runs
- **THEN** the host keeps either its previous or the complete new state, and the
  next status read reports which

### Requirement: Manifest-bound changes

World SHALL keep a manifest on each host listing, per harness, the package
version, every file it created with its digest, every harness command it ran and
every configuration entry it added with the bytes it replaced. Removal SHALL use
the harness's own uninstall commands, delete only files in the manifest and
restore each replaced value exactly. When the user has disabled World's plugin
or changed a World file or entry, World SHALL report `changed_by_user` and SHALL
leave it as the user set it on update and removal. World SHALL NOT modify,
remove, reorder or report under the identity of Herdr's integration files or
entries, and SHALL NOT write a harness's trust state or pass a trust-bypass
option.

#### Scenario: Install and remove round trip
- **WHEN** the operator installs and then removes the Claude Code package on a
  host
- **THEN** the plugin and World's marketplace are gone from `claude plugin list`,
  World's files are deleted, and every Claude setting other than the entries
  Claude's own plugin commands manage is byte-identical to before the install

#### Scenario: User disabled the plugin
- **WHEN** the user disables World's plugin in the harness after installation
- **THEN** status reports `changed_by_user`, and update does not enable it again

#### Scenario: Herdr's integration present
- **WHEN** Herdr's integration for the same harness is installed on the host
- **THEN** installing, updating and removing World's package leaves Herdr's
  script and its hook entries byte-identical

#### Scenario: Unparseable configuration
- **WHEN** a configuration file World would edit itself cannot be parsed
- **THEN** World changes nothing for that harness and reports why

### Requirement: Visible integration state

World SHALL show, per host and harness, World's package beside Herdr's
integration in Settings → Agent integrations and in `herdr-world integration
status`. The state SHALL be one of `harness_missing`, `unsupported`,
`not_installed`, `current`, `outdated`, `changed_by_user`, `waiting_for_trust` or
`unknown`, with the installed and available package versions and the time of
the latest heartbeat. A state that cannot be read SHALL show as `unknown`, never
as installed or not installed.

#### Scenario: Package installed but not yet trusted
- **WHEN** World's Codex package is installed and no heartbeat from it has
  arrived since installation
- **THEN** Settings shows it as waiting for trust in Codex, and World changes
  nothing in Codex's trust state

#### Scenario: Unreachable host
- **WHEN** an SSH host is offline
- **THEN** its rows show the last known state as stale and offer no install,
  update or remove action

### Requirement: Bounded package data channel

A package SHALL report to World only by writing records to a spool on its own
host: one small, versioned JSON file per record kind and configuration scope,
written atomically with owner-only permissions, replacing the previous record.
Records SHALL contain only numbers, timestamps, package and harness versions,
allow-listed enums and opaque digests; never conversation content, prompts,
file paths, native session IDs, account or plan fields, tokens or credentials.
A package SHALL NOT wait on the network or on World, and SHALL NOT fail or
change the harness's behaviour when the spool cannot be written. World SHALL
read the spool only through the host's qualified connection, with the file,
size and validation bounds of other usage sources, and SHALL publish only
validated fields.

#### Scenario: Claude limits from a session World did not start
- **WHEN** the Claude Code package is current on a host and the user runs Claude
  Code in a terminal outside World and gets one answer
- **THEN** the package records the five-hour and weekly limit numbers in the
  spool, and World's Claude gauge for that host shows them with source
  `claude-plugin`

#### Scenario: Record with unknown fields
- **WHEN** a spool record contains a field outside its kind's allow list
- **THEN** World ignores that field and publishes none of its value

#### Scenario: Spool not writable
- **WHEN** the spool folder cannot be written
- **THEN** the session runs unchanged and World shows the last reading as stale
  once it ages

### Requirement: Per-launch tap fallback

When World starts a Claude agent, it SHALL determine whether the session will
load World's current Claude Code plugin with mod support, using Claude Code's
settings precedence in the launch folder. World SHALL add #727's per-launch
status line tap only when it will not. The tap and the plugin SHALL write the
same record kind.

#### Scenario: Plugin covers the launch
- **WHEN** World starts a Claude agent on a host whose plugin is current,
  enabled and supported by the installed Claude Code
- **THEN** the launch carries no per-launch status line settings and the gauge
  still receives readings

#### Scenario: Plugin missing, disabled or unsupported
- **WHEN** World starts a Claude agent where the plugin is not installed, is
  disabled for the user or the project, or the Claude Code version has no mods
- **THEN** the launch keeps the per-launch tap
