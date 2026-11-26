## MODIFIED Requirements

### Requirement: Help that ships with each feature

Each user-facing feature SHALL declare its help beside its code: a title,
what it is, at most five steps, where it lives, the control it points at and
the version it arrived in.

#### Scenario: Help that ships with each feature acceptance rules

- **WHEN** World presents settings, commands or feature help
- **THEN** World's help (**What can I do here?**), the Town
  Master's news, docs/HELP.md and the website's help page SHALL come from these
  declarations. Help SHALL open on the tab for the current screen and offer
  **Try** for each entry, which marks the control on screen, or the button that
  opens its menu when the control is inside a closed one, and says where to find
  it when it is not on this screen.

  Each declaration's pictures SHALL be generated from the synthetic scenes at
  phone and desktop sizes, in light and dark. The repository's help check SHALL
  fail, naming the entry, when an entry's control is no longer marked in any
  component, pictures are missing, or pictures are orphaned. Stale picture input
  fingerprints SHALL warn without failing feature PRs. Feature PRs SHALL capture
  only entries they add or change; other UI changes SHALL leave pictures alone.
  After pushes to main, stale fingerprints SHALL cause one bot PR to regenerate
  pictures, their manifest and docs/HELP.md. The bot SHALL update that PR, label it
  for the owner's merge rule and dispatch its checks; it SHALL never push to main.
  The PR description check SHALL fail when a change fragment adds something
  without a changed help declaration or a stated reason.

#### Scenario: A control is renamed

- **WHEN** a component stops marking a control that a help entry points at
- **THEN** the help check fails and names the entry and the control

#### Scenario: A pictured style changes

- **WHEN** a stylesheet or component that the picture stage renders changes
  and the pictures are not regenerated
- **THEN** the feature PR's help check warns and passes if structure is valid
- **AND** the feature PR need not regenerate any pictures
- **AND** after merge, the main workflow refreshes pictures in one bot PR

#### Scenario: A new help entry has no picture

- **WHEN** a feature declares a new help entry without its required pictures
- **THEN** the help check fails and names the entry

#### Scenario: The refresh PR merges

- **WHEN** regenerated pictures and fingerprints merge to main
- **THEN** the freshness check passes and no further refresh PR is created

#### Scenario: What can I do here?

- **WHEN** the user opens help on Town, Board, Code or Chat
- **THEN** help shows that place's entries, each with a picture and Try

#### Scenario: Try a Code entry from another view

- **WHEN** the user presses Try on a Code entry while another view is shown
- **THEN** World switches to Code and marks the entry's control there
