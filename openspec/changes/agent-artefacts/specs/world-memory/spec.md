# World memory

## MODIFIED Requirements

### Requirement: Library in the browser

World SHALL present memory as one Library dialog, opened from Town's library
building, the town center ring, Board's hub and an agent's settings, with the
same components for TUI and core connections.

#### Scenario: Library in the browser acceptance rules

- **WHEN** World discovers or presents memory sources and their Library readers
- **THEN** It SHALL show readers (a host, a
  project or an agent, with an agent's candidate load), shelves per source with
  size, age, staleness and sharing, and one open entry read fresh from its host.
  Contents SHALL live only in the dialog; only catalog metadata may be cached, for
  counts. Every call SHALL name the Library's chosen connection and generation.
  The Library's memory (its project and agent choices and memory shelves) and
  its memory counts SHALL appear only where an observed harness has an adapter;
  unsupported harnesses SHALL NOT appear with zero memory counts. A host
  without one SHALL appear (host choice, entry points, Town sign) only while
  agents made something there, showing only that (world-artefacts). Visibility SHALL depend on adapter
  support rather than the presence or count of files. A missing, non-refused
  source within the managed `.md` format SHALL offer explicit creation of its
  first entry. Browse-only rule formats SHALL NOT offer ineffective creation.

#### Scenario: Fresh project memory
- **WHEN** a project's memory folder does not exist yet
- **THEN** its shelf offers to add the first note, and creating it makes the folder

#### Scenario: Unsupported-only host
- **WHEN** a live host has no agent whose harness has a memory adapter
- **THEN** its memory is not read, and it has no Library host choice, Town sign, Town/Board Library entry or Settings Library entry unless agents made something there

#### Scenario: Mixed project readers
- **WHEN** a supported and an unsupported agent share a project
- **THEN** the project and supported agent have Library entries, while the unsupported agent has none and is never presented as zero memories
