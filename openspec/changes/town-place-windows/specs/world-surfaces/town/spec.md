## ADDED Requirements

### Requirement: Town place buildings open their windows

A press on a Town place's building — the post office, the library, the
Apartments, the observatory or the warehouse — SHALL open what that place's
sign opens, as a press on the sign does.

#### Scenario: Town place building acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** the building SHALL open its window on a mouse click and on a
  touch tap alike; hovering it SHALL mark its sign as the target; the signs
  SHALL remain the keyboard targets; a building whose sign opens nothing at
  that moment (such as the warehouse while GitHub is still being read) SHALL
  open nothing; the town center SHALL keep its radial menu

#### Scenario: Press the post office building

- **WHEN** the user clicks the post office's house away from its sign
- **THEN** Needs you opens in the place window

#### Scenario: Warehouse building follows its sign

- **WHEN** the GitHub source is off and the user taps the warehouse building
- **THEN** Integrations opens in the place window, as the warehouse's sign
  opens it

### Requirement: One Town place window

Every window a Town place opens SHALL use one frame: a centred modal of one
size over dimmed Town, with the same header, title and close button.

#### Scenario: Town place window acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** Escape and Back SHALL close the topmost window through the layer
  stack; content taller than the frame SHALL scroll inside it rather than
  growing it or going full screen; on a phone the frame SHALL be a sheet
  from the bottom edge, full width, that keeps a strip of Town visible above
  it; what each window contains SHALL be unchanged; the post office's Needs
  you window SHALL leave the Needs you tab as it was when it closes, SHALL
  keep an answer typed but not sent when it opens over the tab or closes
  back to it, and SHALL not be remembered across reloads; a press on dimmed
  Town around the window SHALL close it

#### Scenario: Same frame for every place

- **WHEN** the user opens the post office, library, Apartments, observatory
  and warehouse windows in turn on a wide screen
- **THEN** each is centred over dimmed Town at the same size with the same
  header and close button

#### Scenario: Phone sheet

- **WHEN** the user taps a place building on a phone
- **THEN** its window rises from the bottom edge across the full width and a
  strip of Town stays visible above it
