## ADDED Requirements

### Requirement: Herdr-shaped World integration per harness

World SHALL offer one integration per harness that Herdr integrates, under
Herdr's harness names, through `herdr-world integration install <harness>`,
`herdr-world integration uninstall <harness>` and `herdr-world integration
status [<harness>]`. Each integration SHALL consist only of World-named files in
the harness's own user extension folders, plus, where stated, one World-owned
configuration entry. Each World file SHALL carry the marker lines `installed by
herdr-world`, `HERDR_WORLD_INTEGRATION_ID=<id>` and
`HERDR_WORLD_INTEGRATION_VERSION=<n>`. World SHALL resolve each harness's
folders from the same variables Herdr uses, and SHALL NOT create a harness's
configuration folder. Nothing SHALL be installed except by an explicit install
command or Settings action.

#### Scenario: Status lists every harness
- **WHEN** the operator runs `herdr-world integration status`
- **THEN** it prints one line per Herdr harness name in Herdr's form,
  `<harness>: <state> (<path or reason>)`, where state is `current (vN)`,
  `outdated (vN)`, `not installed` or `unsupported`

#### Scenario: Harness folder missing
- **WHEN** the operator installs an integration for a harness whose
  configuration folder does not exist on the host
- **THEN** World writes nothing and says the folder must exist first

#### Scenario: Status from the files
- **WHEN** World's file for a harness is missing, has a lower version marker or
  has the release's version
- **THEN** status reports `not installed`, `outdated (vN)` or `current (vN)`
  respectively, without any other installation record

### Requirement: World skill for every harness

Every integration SHALL install the World skill as `herdr-world/SKILL.md` in the
harness's user skill folder, with Agent Skills frontmatter, the World marker
lines, and as its body the release's `herdr-world --skill` text, which SHALL
cover `ask`, `result`, `task-summary` and `stamp`. A harness without a
documented user skill folder SHALL report `unsupported` with the reason, and
install SHALL write nothing for it. Harnesses that share a user skill folder
SHALL share one file, and uninstalling for one of them SHALL name the others
that lose it.

#### Scenario: Install the skill for Codex
- **WHEN** the operator runs `herdr-world integration install codex`
- **THEN** `herdr-world/SKILL.md` appears in Codex's user skill folder with the
  release's version, and status for `codex`, `pi` and `kimi` shows that path

#### Scenario: Harness without a skill folder
- **WHEN** the operator installs the integration for a harness whose skill
  folder is not documented
- **THEN** World writes nothing and reports `unsupported` with the reason

#### Scenario: Guide changes
- **WHEN** a release changes the `herdr-world --skill` text
- **THEN** the skill version is higher than the previous release's, and
  installed copies report `outdated`

### Requirement: Claude limits tap as a chained status line

The `claude` integration SHALL also install #727's status line tap as a
World-named script in Claude's user hooks folder, save the user-scope
`statusLine` value it replaces in a World-owned file beside it with owner-only
permissions, and set `statusLine` in the user `settings.json` to that script,
keeping every other key. The tap SHALL run the saved previous command with the
same input and return its output unchanged, and SHALL record only the limit
numbers and times in the file the usage collector already reads. Uninstall
SHALL restore the saved value exactly, or remove the key if there was none.
Status for `claude` SHALL be `current` only when the skill, the script, the
saved value and the entry are all present and current.

#### Scenario: Claude limits from a session World did not start
- **WHEN** the `claude` integration is current on a host and the user runs
  Claude Code in a terminal outside World and gets one answer
- **THEN** the user's own status line output is shown unchanged, and World's
  Claude gauge for that host shows the five-hour and weekly numbers

#### Scenario: Install and uninstall round trip
- **WHEN** the operator installs and then uninstalls the `claude` integration
- **THEN** `settings.json` is identical to before install, apart from
  formatting that preserves every key and value, and World's files are gone

#### Scenario: User replaced the status line
- **WHEN** the user sets a different `statusLine` after installation
- **THEN** status for `claude` reports `outdated`, and World does not
  re-register until the operator reinstalls

#### Scenario: Unparseable settings
- **WHEN** Claude's `settings.json` cannot be parsed
- **THEN** World changes nothing for `claude` and reports why

### Requirement: Coexistence with Herdr and the user

World SHALL NOT modify, remove, reorder or read as its own any of Herdr's
integration files or entries. It SHALL NOT edit any configuration key other than
the entries this capability names, and SHALL NOT write a harness's trust state.
Uninstall SHALL delete only World's files and entries. All writes SHALL be
atomic.

#### Scenario: Herdr's integration present
- **WHEN** Herdr's integration for the same harness is installed
- **THEN** installing, updating and uninstalling World's integration leaves
  Herdr's files and entries byte-identical, and `herdr integration status` is
  unchanged

### Requirement: Per-host Settings and updates

Settings → Agent integrations SHALL show World's state, version and path
beside Herdr's for each harness and host, with Install, Update and Remove.
World SHALL run the installer on a host only through that host's qualified
local or SSH connection. Install and uninstall SHALL be operator actions, and
agent-originated calls SHALL be denied. After an explicit World update or
Herdr upgrade, World SHALL reinstall its own `outdated` integrations and SHALL
NOT install others.

#### Scenario: Install on an SSH host
- **WHEN** the operator installs an integration on an SSH host from Settings
- **THEN** only that host changes, through its qualified connection, and its row
  reports the result

#### Scenario: Unreachable host
- **WHEN** an SSH host is offline
- **THEN** its rows show the last known state as stale and offer no actions

#### Scenario: Upgrade with one integration installed
- **WHEN** World is upgraded on a host with an outdated `claude` integration and
  no `codex` integration
- **THEN** `claude` is reinstalled at the new version and `codex` stays not
  installed
