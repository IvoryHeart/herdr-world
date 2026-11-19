# Desktop IDE handoff

## Purpose

Open admitted World projects and files in an installed desktop IDE on the World
host, preserving local or SSH ownership across Herdr TUI and herdr-core.

## Requirements

### Requirement: Host desktop integrations

World SHALL detect supported desktop launchers on the World service host using
read-only PATH and known installation-location checks. Discovery SHALL NOT launch,
install, update or download software. Configuration → Integrations SHALL show
installed/missing providers and permit a persisted default or Always choose.
The picker SHALL put the saved default first without silently choosing another IDE.
One static registry entry SHALL describe each product and its launch family.

#### Scenario: Phone selects an IDE

- **WHEN** the owner opens integrations or Open in… from a phone
- **THEN** World explains that detection and launch concern the World host’s desktop, retains the browser page, and offers accessible choices sized for the phone

#### Scenario: Launcher missing

- **WHEN** discovery cannot find a supported launcher
- **THEN** that choice is disabled with launcher setup guidance and a refresh action; an open request rechecks availability before dispatch

### Requirement: Qualified project handoff

Open in… SHALL be available from the shared agent Inspector reached through Desk,
Town, Board and Spaces; Town/Board room controls; Files project/folder/file controls;
and Changes file/folder menus. Handoff SHALL require an explicit immutable
connection ID, runtime generation and workspace ID. Agent requests SHALL retain
the selected worktree’s subject, session, revision and candidate. Existing Files
admission SHALL resolve canonical targets and enforce relative-path and symlink
containment; absolute paths SHALL require explicit filesystem scope. World SHALL
recheck the captured runtime and authenticated browser before launch and SHALL
NOT fall back to another connection or an ambiguous agent worktree.

#### Scenario: Open an agent source line

- **WHEN** the owner chooses a file’s Open in… action and an installed IDE
- **THEN** World resolves the file through the same selected agent worktree and passes that path and optional line as fixed IDE arguments

#### Scenario: Project or session changes during admission

- **WHEN** the connection retires or the selected worktree/session can no longer be admitted
- **THEN** World refuses before launching an IDE, retains the selection, and explains that the owner must refresh or choose a current worktree

### Requirement: Safe local and SSH launch

Only authenticated browser operators SHALL invoke desktop handoff verbs. World
SHALL accept fixed provider IDs and target fields, never browser command strings,
executables, arbitrary options or credentials. The service SHALL dispatch a locally
detected IDE with argument arrays, independently of the World service lifetime.
Linux service launches SHALL use a separate systemd user scope; macOS SHALL use
LaunchServices. Failed isolation or activation SHALL refuse without falling back
to a service-owned IDE process. Local projects SHALL open locally.
VS Code and Cursor SSH handoffs SHALL use the exact stored OpenSSH destination
and explicit file/folder forms; Zed SHALL use an encoded SSH URL. Existing OpenSSH
configuration and IDE remote support remain prerequisites. JetBrains SSH requests
SHALL be refused with Gateway setup guidance; Windows SSH targets SHALL be
refused while the owning Files admission is unsupported. Local JetBrains IDEs
SHALL remain available through their installed launchers. A successful response
SHALL acknowledge dispatch, without claiming a visible desktop window.

#### Scenario: Unsupported SSH provider

- **WHEN** the owner selects JetBrains for an SSH project
- **THEN** World explains the missing Gateway backend link without opening the remote path as a local directory

#### Scenario: Desktop launcher fails

- **WHEN** the detected executable cannot start or exits unsuccessfully during launch admission
- **THEN** the picker shows a desktop-session or launcher error and permits an explicit retry without automatic replay

#### Scenario: World service restarts after handoff

- **WHEN** an IDE that was not running opens through World installed as a Linux user service, and World later restarts
- **THEN** the IDE and its terminals remain outside World's service cgroup and continue running

#### Scenario: Desktop activation cannot isolate the IDE

- **WHEN** the systemd user scope or macOS LaunchServices activation fails
- **THEN** World reports a launcher error without retrying as a direct service child
