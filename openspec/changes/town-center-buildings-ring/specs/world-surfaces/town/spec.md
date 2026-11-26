## ADDED Requirements

### Requirement: Town center ring

The town center SHALL open a ring of non-building actions plus Buildings,
with no counts. Buildings SHALL open a ring of each available place with a
building, opening what its building opens. A later ring SHALL centre on its
opening entry, fitted, with Back there; Back, Escape and phone Back SHALL
return one ring, a press outside closes all. Labels SHALL sit outside the
ring beyond their icons. Rings SHALL work with arrows, Enter, touch and a
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

#### Scenario: Labels outside the ring

- **WHEN** any ring is open, on a desktop or a phone
- **THEN** each entry's label sits beyond its icon, outside the ring
- **AND** no label covers another entry, another label or the ring
