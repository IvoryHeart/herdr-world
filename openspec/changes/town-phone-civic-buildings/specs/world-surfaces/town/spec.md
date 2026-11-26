## ADDED Requirements

### Requirement: A narrow Town stands every civic building

A narrow (phone or portrait) Town SHALL stand every civic building a wide
Town stands (the post office, library, observatory, Apartments, warehouse
and harbour) as that building, in the same art scaled with the town, never
as a folded sign or icon on the town center or elsewhere. Each building
SHALL keep its live contents and its own sign, and SHALL open what it opens
on a wide Town.

#### Scenario: Narrow civic building acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** the library and observatory SHALL stand in the wide town's civic
  row right of the town center, on the first street; the post office SHALL
  stand left of the center with its full sign over its own house; the
  harbour SHALL stay at the town's right edge; each building SHALL be
  reachable by panning at home zoom, at least 44 CSS pixels wide and tall
  there, with its sign readable; no civic building SHALL overlap a host's
  building, the town center, another civic building or a bus stop; no
  civic building's sign SHALL cover another civic building's sign or the
  town center's plaque at home zoom or zoomed out, whatever the signs say,
  so a tap on a sign opens that sign's place; a wide Town's layout SHALL be
  unchanged

#### Scenario: Pan to the library on a phone

- **WHEN** the user pans a phone's Town right from its home view
- **THEN** the library stands with its shelves and the observatory with its
  usage sign, as on a wide Town, and no small sign for either is on the town
  center

#### Scenario: Tap a civic building on a phone

- **WHEN** the user taps the library, observatory, post office, Apartments
  or warehouse building on a phone
- **THEN** the same place window opens as on a wide Town, as a sheet from
  the bottom edge
