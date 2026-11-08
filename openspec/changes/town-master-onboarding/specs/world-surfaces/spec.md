## ADDED Requirements

### Requirement: Town Master greeting

World SHALL greet the owner once per visit with the Town Master's card while
**Show this on start** is on, which it SHALL be by default. A visit SHALL be
World opening, or the World page coming back on screen after being hidden for
30 minutes or more. The Town Master SHALL be World's own script, with no agent
behind it.

The card SHALL say hello with the time the owner was last here, show the same
since-you-left lines as the Town board sign, each opening Needs you as the
board's line does, or one line saying nothing is new, and, when World's
update check reports a newer release, one line naming it whose control leads
to World's update control. The greeting SHALL NOT install anything, answer,
merge or review.

On wide screens the card SHALL open from the Town Master's figure beside the
Town board, at the hub in Board and at the summary in Desk; on phones it SHALL
be a sheet with Back. The card SHALL close with ✕, Escape, Back or a press
outside it. It SHALL NOT draw over an open window or sheet such as Chat or
Needs you: a greeting due while one is open SHALL wait until none is.

**Show this on start** at the card's foot and its setting SHALL be one value
kept per browser. The owner's very first visit on a browser, with no last time
known, SHALL have no greeting.

#### Scenario: Greeted on return

- **WHEN** the owner opens World after being away
- **THEN** the Town Master's card says when they were last here and lists the
  board sign's since-you-left lines
- **AND** choosing a line opens Needs you at its item and closes the card

#### Scenario: A window is open

- **WHEN** a visit starts while Chat or Needs you is open
- **THEN** no greeting covers it
- **AND** the greeting opens once nothing is open

#### Scenario: Turned off

- **WHEN** the owner unticks **Show this on start**
- **THEN** later visits on that browser do not greet
- **AND** switching the setting back on greets again from the next visit

#### Scenario: Short absence

- **WHEN** the page comes back on screen after less than 30 minutes hidden
- **THEN** it is not a new visit and no greeting opens
