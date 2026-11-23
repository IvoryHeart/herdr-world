## ADDED Requirements

### Requirement: Town center ring

The town center SHALL open a ring of actions that are not a building plus one
Buildings entry, with no counts on its entries. Buildings SHALL open a second
ring in place listing every place with a building that opens now; choosing
one SHALL open what its building opens. Back at the centre, Escape and the
phone's Back SHALL return to the first ring; a press outside SHALL close both.
Both rings SHALL work with arrows, Enter, touch and a screen reader and fit a
phone with targets of one size.

#### Scenario: Open the Library through Buildings

- **WHEN** the user opens the town center, chooses Buildings, then Library
- **THEN** the ring closes and the Library opens as a press on its building does
- **AND** no ring entry shows a count

#### Scenario: Return from the second ring

- **WHEN** the second ring is open and the user presses Escape or the centre's Back
- **THEN** the first ring returns with Buildings focused
- **AND** a second Escape closes the ring
