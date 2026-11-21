## ADDED Requirements

### Requirement: Apartments resident avatars

The Apartments window SHALL draw every resident, in its list and in the
opened resident view, with the avatar components live agents use: its Town
character on its colour tile with its harness icon, alongside its harness,
project, room and host.

#### Scenario: Apartments resident avatars acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** Herdr TUI and herdr-core residents SHALL share one
  look. A resident's avatar SHALL be, in order: the Town character kept at
  move-in; else, when the kept record names no profile, the character Town
  draws from the resident's terminal identity; else the named profile's current
  look; else the look of a profile with the same harness; else World's default
  character for its terminal identity. The window SHALL say, on the avatar,
  when it shows a profile's, a same-harness or the default avatar. A resident
  without a kept colour SHALL show the plain tile. The window SHALL never show
  a blank or broken avatar.

#### Scenario: Resident with a kept avatar

- **WHEN** an agent with an avatar chosen for its pane ends and moves in
- **THEN** its resident shows that character on the colour its table had in
  Town, in the list and in the resident view

#### Scenario: Spawned resident keeps its inherited colour

- **WHEN** a spawned agent whose table has no colour of its own, in a room
  of another colour, ends while its parent's table is teal
- **THEN** its resident shows teal, the colour Town showed, not the room's

#### Scenario: Resident from before avatars were kept

- **WHEN** a resident record has no appearance and no profile with its
  harness exists
- **THEN** the window shows World's default character for its terminal
  identity on the plain tile and says it is the default avatar

#### Scenario: Profile deleted after move-in

- **WHEN** a resident's kept look is unreadable, its profile was deleted and
  another profile of the same harness exists
- **THEN** the window shows that profile's look and names it as the nearest
  avatar
