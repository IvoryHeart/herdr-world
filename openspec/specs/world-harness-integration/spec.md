# World harness integration

## Purpose

Manage World skills and the Claude limits tap on the local service host while
preserving harness configuration, Herdr integrations and explicit removal choices.

SSH Settings management and the remaining qualified upgrade refresh are
pending in the [active change](../../changes/world-harness-integration/tasks.md).
The [integration guide](../../../docs/harness-integrations.md) records current
paths, discovery and runtime support.

## Requirements

### Requirement: Herdr-shaped World integration per harness

World SHALL offer one integration per harness that Herdr integrates, under
Herdr's harness names, through `herdr-world integration install <harness>`,
`herdr-world integration uninstall <harness>` and `herdr-world integration
status [<harness>]`.

#### Scenario: Integration files and installation authority

- **WHEN** World installs, removes or inspects a harness integration
- **THEN** Each integration SHALL consist only of World-named files in
  the harness's own user extension folders, plus, where stated, one World-owned
  configuration entry. Each World file SHALL carry the marker lines `installed by
  herdr-world`, `HERDR_WORLD_INTEGRATION_ID=<id>` and
  `HERDR_WORLD_INTEGRATION_VERSION=<n>`. World SHALL resolve each harness's
  folders from the same variables Herdr uses, and SHALL NOT create a harness's
  configuration folder. Installation SHALL follow an explicit install command, local Settings action
  or the local discovery flow specified below; observation and normal service
  startup SHALL NOT install integrations.

#### Scenario: Status lists every harness
- **WHEN** the operator runs `herdr-world integration status`
- **THEN** it prints one line per Herdr harness name in Herdr's form,
  `<harness>: <state> (<path or reason>)`, where state is `current (vN)`,
  `outdated` (with `vN` when parseable), `not installed` or `unsupported`

#### Scenario: Harness folder missing
- **WHEN** the operator installs an integration for a harness whose
  configuration folder does not exist on the host
- **THEN** World writes nothing and says the folder must exist first

#### Scenario: Status from the files
- **WHEN** World's file for a harness is missing, has a lower or invalid version
  marker, or has at least the release's version
- **THEN** status reports `not installed`, `outdated` (with a version only when
  parseable) or `current (vN)` respectively, without another installation record

### Requirement: World skill for every harness

Every integration SHALL install the World skill as `herdr-world/SKILL.md` in the
harness's user skill folder, with Agent Skills frontmatter, the World marker
lines, and as its body the release's `herdr-world --skill` text, which SHALL
cover `ask`, `result`, `task-summary` and `stamp`.

#### Scenario: Skill folder support and shared ownership

- **WHEN** World installs or uninstalls a harness skill
- **THEN** A harness without a
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
World-named script under Claude's user configuration folder, save the user-scope
`statusLine` value it replaces in a World-owned file beside it with owner-only
permissions, and set `statusLine` in the user `settings.json` to that script,
keeping every other key.

#### Scenario: Claude tap chaining and restoration

- **WHEN** World installs, runs or removes the Claude limits tap
- **THEN** The tap SHALL run the saved previous command with the
  same input and return its output unchanged, and SHALL record only the limit
  numbers and times in the file the usage collector already reads. Uninstall
  SHALL restore unchanged settings bytes exactly, including an absent file or
  key, and SHALL preserve intervening user edits. A user-scope tap SHALL chain
  with the per-launch tap without recursion; missing World runtime support SHALL
  still run the saved command with its input/output unchanged.
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

### Requirement: Local Settings integration management

Settings → Agent integrations SHALL show World's state, version and path beside
Herdr's for the local service host, with Install, Update and Remove using the
same installer and environment as the CLI. Install and uninstall SHALL be
operator-only actions; agent-originated calls SHALL be denied. Local actions
SHALL NOT mutate an SSH host or choose another connection as fallback.

#### Scenario: Install from local Settings
- **WHEN** the operator chooses Install for a supported local harness
- **THEN** the local World row reports the installed release's integration
  and Herdr's integration remains unchanged

#### Scenario: An agent tries to install
- **WHEN** an agent invokes a World integration install or uninstall verb
- **THEN** admission refuses it before filesystem mutation

### Requirement: Local discovery and persistent removal preferences

Standalone installation and World update, including an already-current update,
SHALL discover supported local harnesses by existing configuration folders and
install or refresh World integrations without launching a harness or creating
its configuration folder.

#### Scenario: Discovery opt-outs and removal preferences

- **WHEN** World discovers or synchronizes local harness integrations
- **THEN** `integration sync` SHALL perform the same discovery.
  `HERDR_WORLD_SKIP_INTEGRATIONS=1` SHALL skip it independently of the Herdr runtime
  opt-out; `update --check` and ordinary startup SHALL remain read-only.
  Uninstall SHALL persist a removal preference even for an absent integration;
  subsequent discovery SHALL respect it until explicit Install reenables it.
  Codex, Pi and Kimi SHALL share both their skill and removal preference. An
  unmarked or foreign skill SHALL be preserved and refused; per-harness failures
  SHALL be reported without stopping discovery for other harnesses.

#### Scenario: A removed shared skill stays removed
- **WHEN** Codex is uninstalled and a later installer, update or sync discovers Pi
- **THEN** the shared skill stays removed until an explicit install for a member
  reenables the group

#### Scenario: Automatic discovery is disabled
- **WHEN** installation or update runs with `HERDR_WORLD_SKIP_INTEGRATIONS=1`
- **THEN** it changes no World integration, independently of runtime setup choices
