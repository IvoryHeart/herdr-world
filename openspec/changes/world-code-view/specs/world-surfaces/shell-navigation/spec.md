## MODIFIED Requirements

### Requirement: Common view navigation

The native World shell SHALL offer Town, Board, Desk, Code and Spaces once each and SHALL keep rendered
view, browser history and canonical paths `/town`, `/board`, `/desk`, `/code` and `/spaces` consistent.

#### Scenario: Common view navigation acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** The
  World root and unknown paths SHALL resolve to Town. Invalid view values SHALL resolve to Town, except
  the retired values covered by Retired view addresses; explicit canonical paths, including `/desk` and `/code`,
  SHALL retain their requested views.
  The view selector SHALL occupy the existing Roamgate-derived top bar between the World version and
  Hosts filter; a muted aggregate health indicator with the bounded space/agent/stale summary
  in its accessible label and tooltip SHALL remain in that top bar. The shell SHALL provide one shared
  view-control slot there for view-specific search and controls. World SHALL NOT stack a second
  view-navigation, Visual Control Plane status bar or view-local search/zoom header above the
  application stage.
  The inherited Spaces workspace navigator, focused tab strip and review-annotations control SHALL
  remain the common frame around Town, Board, Desk, Code and Spaces. Changing views SHALL replace only the
  center surface. Inspector-created review drafts SHALL remain visible and editable through the same
  workspace-qualified annotation panel in every view. Selecting a workspace or pane through either
  the navigator or the focused tab strip SHALL resolve through the same qualified World selection
  path and update the docked Inspector only after exact focus succeeds.
  Town SHALL be the primary default surface after a valid managed profile is selected. Town and Board
  SHALL remain spatial views of the same topology, and Spaces SHALL remain the first-class
  operational workspace and profile-management surface rather than being removed or embedded into
  another view.
  The common shell SHALL expose Manage connections separately from its Hosts filter using the
  existing managed catalogue. Every operational workspace or Inspector SHALL identify its owning host
  and state. The common navigator SHALL group workspaces by host within the filter; an already-open
  workspace outside that filter SHALL retain its labelled context.
  Inspector presentation, Town calm motion and optional observability configuration SHALL live in the
  common settings menu on desktop, compact and Zen layouts.

#### Scenario: Browser history across views

- **WHEN** a user selects Board, selects Desk and then navigates Back
- **THEN** the URL and rendered view return to Board while the same shell retains terminal and
  Inspector ownership and each context's owning host

#### Scenario: Use the single application top bar

- **WHEN** a user changes among Town, Board, Desk, Code and Spaces
- **THEN** the view selector, version, aggregate health summary, Hosts filter, Manage connections,
  applicable view controls and shell tools remain in one top bar and the selected view receives all
  remaining vertical workspace

#### Scenario: Use the common workspace frame

- **WHEN** a user changes among Town, Board, Desk, Code and Spaces with the current host filter
- **THEN** the same workspace navigator, focused tab context and annotations control remain
  available while only the center presentation changes

#### Scenario: Edit visual-view annotations

- **WHEN** a user creates or edits a terminal, file or diff review annotation from a visual-view
  Inspector
- **THEN** the common annotation panel opens for that exact connection-qualified workspace and all
  Inspector presentations observe subsequent edits without switching to Spaces

#### Scenario: Manage a host

- **WHEN** a user needs to add, edit, test, connect or remove a profile from a visual World view
- **THEN** Manage connections exposes the existing workflow from the common shell without changing
  the current view, filter or unrelated contexts

#### Scenario: Open World with a managed profile

- **WHEN** a user opens the World root with a valid restored or default managed profile
- **THEN** World opens Town as the primary surface and keeps Board, Desk, Code and Spaces available
  through the same navigation and shell

#### Scenario: Open the default view

- **WHEN** a user loads the World root, an unknown route or an invalid view value
- **THEN** Town appears within the common shell and connection onboarding remains
  available if no admitted runtime exists

#### Scenario: Open an explicit view route

- **WHEN** a user loads `/town`, `/board`, `/desk`, `/code` or `/spaces`
- **THEN** the requested view appears and subsequent browser history preserves that
  explicit selection

#### Scenario: Code is another World projection

- **WHEN** a user opens a qualified room in Code and navigates back to Town or Board
- **THEN** history, shell and entity context remain consistent without creating another app or duplicating terminal ownership
