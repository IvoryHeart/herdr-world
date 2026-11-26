## ADDED Requirements

### Requirement: One search

World SHALL have one search, the command box: `/`, Ctrl+F or Cmd+F, Ctrl+K or Cmd+K, a
view's search button and Find or act SHALL open the same box, and no view SHALL keep its
own. Its results SHALL come from pluggable sources, commands in their own group.
Choosing a found World object SHALL go to it in the current view, or open it there where
the view cannot show it; opening its terminal SHALL be a second action. Nothing chosen
SHALL change the view.

#### Scenario: The same box from every key

- **WHEN** the user presses `/` in Town and types part of an agent's name, then closes
  the box and presses Cmd+K and types the same name
- **THEN** both open the same box with the same results in the same order, drawn from
  World's objects through World's one matcher, places only the current view draws, the
  box's commands and the settings registry

#### Scenario: Choose goes to the result in Town

- **WHEN** the user in Town types part of an agent's name and chooses it
- **THEN** Town moves its camera to the agent's table and marks it, the view stays Town,
  no terminal opens, and the box stays open with its list of matches
- **AND** choosing the same result again closes the box and opens its Inspector

#### Scenario: Choose goes to the result in Board

- **WHEN** the user in Board types part of an agent's name and chooses it
- **THEN** Board pans to the agent's card, unfolding its workspace if folded, and marks
  it, the view stays Board, no window opens, and the box stays open with its list
- **AND** choosing the same result again closes the box and opens its Inspector, as in
  Town; Desk and Code, which have no map, open it on the first choice

#### Scenario: A click chooses as Enter does

- **WHEN** the user clicks a found result
- **THEN** it is chosen exactly as Enter on that row chooses it, and when the box stays
  open its input keeps focus so Enter chooses again

#### Scenario: Open its terminal instead

- **WHEN** the user in Town, Board, Desk or Code presses Shift+Enter on a found agent,
  or the row's Open terminal
- **THEN** its terminal window opens in that view on the agent's own connection and
  runtime generation, on Herdr TUI and herdr-core alike, and the view stays the same
- **AND** in Spaces the same action opens it in Spaces, and Spaces stays the view

#### Scenario: A result the view cannot show

- **WHEN** the user is in Spaces or Code, or finds an agent on a host the Hosts filter
  hides, and chooses it
- **THEN** it opens without changing the view (Spaces shows it; elsewhere its window
  opens), and its row says so before it is chosen

#### Scenario: Every match stays reachable

- **WHEN** a search finds more World objects than one page of the box shows, including
  ones whose names, places and status read alike so that no further word tells them apart
- **THEN** the box shows a bounded page of them with rows to the next and previous pages
  that keep it open, and every match can be reached and chosen
- **AND** matches that read alike stay separate rows

#### Scenario: A command from the same box

- **WHEN** the user in Board presses Cmd+K and types "new workspace" and chooses it
- **THEN** the new workspace command runs

#### Scenario: The view keeps a chosen search

- **WHEN** the user in Town or Board types a search and chooses a result
- **THEN** the view lights its matches and its toolbar shows the search and its count
  until the user ends it, presses Escape in the view or changes view
- **AND** closing the box without choosing ends the search
- **AND** the search holds only what was typed and chosen, never a copy of World state

#### Scenario: Typing in a terminal

- **WHEN** a terminal or text field has focus and the user types `/` or Ctrl+F
- **THEN** the key reaches the terminal or field and the box stays closed
