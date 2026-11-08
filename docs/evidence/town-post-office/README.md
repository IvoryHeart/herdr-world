# Town post office (#760)

Synthetic composite captures from 2026-11-08. A scratch page draws the
production post office art (`paintTownPostHouse`, `paintTownPostYard`) at its
layout lot for a one-building wide town, plus a plain street and park walk,
and mounts the production `TownPostOffice` DOM layer over it at a fixed zoom.
Its pull requests come from the `?townPostFixture` testing switch: synthetic
titles in `example-org` repositories. The rest of Town (buildings, center,
landscape, actors) is not drawn, so these show the post office itself, not its
place in the whole town; the preview's Town shows that.

Captured in headless Chrome 156 at DPR 1. Golden Town images were not
regenerated: the pinned capture did not start in this environment.

| State | Capture |
| --- | --- |
| Home zoom on a laptop (0.65) | [laptop-home-zoom](laptop-home-zoom.png) |
| Closer zoom: counts, parcels by state, trolley | [close-up](close-up.png) |
| Keyboard focus names a parcel | [focus-label](focus-label.png) |
| Tapping a parcel opens the pull request card | [card-open](card-open.png) |
| GitHub signed out: closed, no parcels, no counts | [signed-out](signed-out.png) |
| More than the yard holds: the "+N" pile | [pile](pile.png) |
| Phone: the folded sign's list | [phone-folded](phone-folded.png) |

After the owner's phone review the folded sign's envelope became the red
pillar box painted by the house door; `phone-folded.png` predates that change.
