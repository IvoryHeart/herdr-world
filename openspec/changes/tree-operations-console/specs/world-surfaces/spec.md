## ADDED Requirements

### Requirement: Common view navigation
The shared sidebar SHALL offer Spaces, Office, Tree and Graph once each through its View picker and SHALL preserve canonical URLs and browser history. Its Hosts picker SHALL retain host connection attention, qualified host selection and Add Host behavior. Compact layouts SHALL provide an explicit way to reopen the current view and restore focus when returning to the sidebar or navigating history.

#### Scenario: Tree through the common sidebar
- **WHEN** a user selects Tree from View and later navigates Back or Forward
- **THEN** the picker, rendered view and canonical `/?theme=tree` history agree, and any existing World terminal session remains owned by the shared shell

#### Scenario: Add Host from Tree
- **WHEN** a user chooses Add Host in the common sidebar while viewing Tree and cancels setup
- **THEN** connection setup uses the existing settings flow, navigation and saved profiles are preserved, and focus returns to Hosts

### Requirement: Tree Operations Console composition
Tree SHALL present the approved compact Operations Console composition with a common sidebar, a central top-down hierarchy and persistent operational inspection context. Cards SHALL distinguish host, space, agent and terminal kinds and expose status without relying on color. Connectors SHALL visibly join authoritative parent and child tiers, including unequal branches, and SHALL not imply hidden or absent child entities. Summary information SHALL derive only from admitted World data and SHALL distinguish presentation omissions.

#### Scenario: Desktop operational scan
- **WHEN** Tree renders observed hosts containing spaces and agent/terminal children
- **THEN** compact cards and connected tiers make their hierarchy legible while selection identity, ancestry, status and available actions remain accessible without leaving Tree

#### Scenario: Collapsed or empty branch
- **WHEN** a host or space has no presented children or is collapsed
- **THEN** it retains its identity and disclosure state without a dangling connector implying visible children

#### Scenario: Compact operation
- **WHEN** Tree is opened at phone width or used with reduced motion
- **THEN** the semantic hierarchy, search, disclosure, selection details and guarded actions remain reachable with named controls and no horizontal page overflow
