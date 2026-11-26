## ADDED Requirements

### Requirement: Distinguishable unnamed app spaces

World SHALL name an app-created core space that has no name in its `where`
captions for display only, once, from the space's oldest terminal that shows
anything: its folder, else its tab, else its agent. World SHALL keep that name
while the space lasts, so agents coming and going, in that room or another,
never change it. The row SHALL say the name is derived and views SHALL mark it.
A derived name another room of the same core already shows SHALL get a number,
kept when other rooms leave. World SHALL NOT write the derived name to core and
SHALL NOT change the space's owner.

#### Scenario: Unnamed app space

- **WHEN** an app-created core space has no name in its `where` captions
- **THEN** its room reads a name derived from its oldest terminal's folder,
  tab or agent, marked as derived, and the name stays as agents come and go
- **AND** with no evidence the room reads `Herdr space`

#### Scenario: Two rooms derive the same name

- **WHEN** two unnamed spaces of one core derive the same name
- **THEN** the later reads with a number (`api`, `api 2`), and keeps it when
  the other room leaves

#### Scenario: World launches into an unnamed space

- **WHEN** World starts an agent in an unnamed app space
- **THEN** its `where` caption says `Herdr space / <tab>` with World's
  placeholder label, never the derived name, while the app's own
  `Herdr space` caption stays a name
