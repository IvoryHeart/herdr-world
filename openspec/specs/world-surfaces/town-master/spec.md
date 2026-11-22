# World town master

## Purpose

Define the user-facing town master contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Town Master greeting

World SHALL greet the user once per visit with the Town Master's card while
**Show this on start** is on, which it SHALL be by default.

#### Scenario: Town Master greeting acceptance rules

- **WHEN** World evaluates a visit or presents the Town Master greeting
- **THEN** A visit SHALL be
  World opening, or the World page coming back on screen after being hidden for
  30 minutes or more. The Town Master SHALL be World's own script, with no agent
  behind it.

  The card SHALL say hello with the time the user was last here, show the same
  since-you-left lines as the Town board sign, each opening Needs you as the
  board's line does, or one line saying nothing is new, and, when World's
  update check reports a newer release, one line naming it whose control leads
  to World's update control. The greeting SHALL NOT install anything, answer,
  merge or review.

  The card SHALL also carry World's help news, drawn from the help
  declarations: under **What's new**, up to four entries newer than the last
  version shown in this browser, each with its picture and **Try**; on a
  browser World has never greeted, **Start here**, the short first-run path,
  instead. Closing the card SHALL mark them seen in this browser, so the next
  visit shows only newer entries.

  On wide screens the card SHALL open from the Town Master's figure beside the
  Town board, at the hub in Board and at the summary in Desk; on phones it SHALL
  be a sheet with Back. The card SHALL close with ✕, Escape, Back or a press
  outside it. It SHALL NOT draw over an open window or sheet such as Chat or
  Needs you: a greeting due while one covers its place SHALL wait until none
  does. On phones any open window or sheet SHALL cover it; on wide screens only
  one over the figure or anchor, or over where the card opens, SHALL cover it,
  so a window docked or floating elsewhere SHALL NOT hold the greeting back.

  **Show this on start** at the card's foot and its setting SHALL be one value
  kept per browser. Turning it off SHALL also stop a greeting that is waiting
  for a window to close. Every visit SHALL greet, the very first on a browser
  too; with no last time known, the hello SHALL leave the time out.

#### Scenario: Greeted on return

- **WHEN** the user opens World after being away
- **THEN** the Town Master's card says when they were last here and lists the
  board sign's since-you-left lines
- **AND** choosing a line opens Needs you at its item and closes the card

#### Scenario: A window is open

- **WHEN** a visit starts while Chat or Needs you is open over the greeting's
  place, or any window or sheet is open on a phone
- **THEN** no greeting covers it
- **AND** the greeting opens once nothing covers its place

#### Scenario: A window elsewhere

- **WHEN** a visit starts on a wide screen while an intent window or Chat is
  docked away from the Town Master and the card's place
- **THEN** the greeting opens beside the Town Master as usual

#### Scenario: Turned off

- **WHEN** the user unticks **Show this on start**
- **THEN** later visits on that browser do not greet
- **AND** switching the setting back on greets again from the next visit

#### Scenario: Short absence

- **WHEN** the page comes back on screen after less than 30 minutes hidden
- **THEN** it is not a new visit and no greeting opens

#### Scenario: What's new after an update

- **WHEN** the user opens an updated World on a browser that was shown an
  older version's help
- **THEN** the card lists what is new since then, each with a picture and Try
- **AND** after the card closes, the next visit does not list them again
