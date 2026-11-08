## Why

The owner decided the onboarding plan on 5 November (decision 4): the Town
Master greets you on every visit, with a **Show this on start** checkbox that
is on by default, and the greeting carries "since you left" and announces
software updates. The owner returns after long absences and asks most often
what happened meanwhile; the recap already exists, but only as small lines on
the Town board sign. The greeting turns the return into a moment without a
second inbox. This change records the Town Master's onboarding; later slices
(the path, lessons, ? marks and the highlight) extend it.

## What Changes

- A scripted Town Master (no agent behind it) stands beside the Town board as
  a small figure in Town's sprites. Board opens its card at the hub beside the
  bin and Desk at its summary; phones show the card as a sheet with Back.
- One greeting per visit: hello with the time you were last here, the board
  sign's since-you-left lines (each opens Needs you), and one update line when
  World's update check reports a newer release, leading to Menu's update entry.
- A visit is World opening, or the page coming back on screen after being
  hidden for 30 minutes or more. The greeting never opens over an open window
  or sheet; it waits until uncovered. On wide screens only a window over the
  figure or the card's place covers it; on phones any open window or sheet
  does.
- **Show this on start** at the card's foot and **Menu → Town Master
  greeting** are one per-browser value, like the since-you-left ✕.

## Capabilities

### Modified Capabilities

- `world-surfaces`: new requirement for the Town Master's greeting.

## Impact

Browser only. The view preferences in browser storage gain `townGreeting`;
older values read as on. No service, protocol or storage change.
