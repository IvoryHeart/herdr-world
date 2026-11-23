## ADDED Requirements

### Requirement: Town center ring

The town center SHALL open a ring of non-building actions plus Buildings,
with no counts. Buildings SHALL open a ring of every place with a building
that opens now; choosing one SHALL open what its building opens. Each later
ring SHALL centre on the entry that opened it, fitted to the view, with Back
there; Back, Escape and phone Back SHALL return one ring, and a press
outside SHALL close all. Rings SHALL work with arrows, Enter, touch and a
screen reader and fit a phone with same-size targets.

#### Scenario: Open the Library through Buildings

- **WHEN** the user opens the town center, chooses Buildings, then Library
- **THEN** the ring closes and the Library opens as a press on its building does
- **AND** no ring entry shows a count

#### Scenario: The second ring opens around Buildings

- **WHEN** the user opens the town center and chooses Buildings
- **THEN** the second ring's centre is where Buildings was, unless it moved to fit the view
- **AND** that centre is Back, named Buildings

#### Scenario: Return from the second ring

- **WHEN** the second ring is open and the user presses Escape or the centre's Back
- **THEN** the first ring returns with Buildings focused
- **AND** a second Escape closes the ring
