import type { HelpEntry } from "../../help/helpEntry";

/** Town's help (web/src/help/helpEntry.ts): declared beside Town's code. */
export const TOWN_HELP: readonly HelpEntry[] = [
  {
    id: "town.zoom",
    title: "Move around Town",
    summary:
      "Town shows every agent at its desk. The camera buttons step between the whole town, one building, one room and one desk.",
    steps: [
      "Press + to step closer to what is in the middle of the screen.",
      "Press − to step back out.",
      "Press ALL to see the whole town again.",
      "Pinching or scrolling zooms too.",
    ],
    place: "town",
    where: "Town, the buttons on the right edge",
    control: "town.zoom",
    since: "0.2.5",
    picture: { scene: "town" },
    firstRun: 1,
  },
  {
    id: "town.daylight",
    title: "Time of day",
    summary:
      "Town follows your clock: rooms with work are lit, idle rooms go dark, and a reception waiting on you glows amber.",
    steps: [
      "Press the sky button under ALL to open the Sky panel.",
      "Under Time of day, choose Your clock, Day, Dusk or Night.",
    ],
    place: "town",
    where: "Town, under the zoom buttons on the right",
    control: "town.daylight",
    since: "0.3.5",
    picture: { scene: "town" },
  },
  {
    id: "town.board-chip",
    title: "The town board as a chip",
    summary:
      "The town board folds into a small chip in the corner. It shows how many agents need you, and fuel when it runs low.",
    steps: [
      "Point at the chip, or tap it on a phone, to open the board.",
      "Press it again to keep the board open; Escape closes it.",
    ],
    place: "town",
    where: "Town, top left corner",
    control: "town.board-chip",
    since: "0.3.6",
    picture: { scene: "town" },
  },
  {
    id: "town.master",
    title: "What's new from the Town Master",
    summary:
      "The Town Master greets you when you come back: what happened since you left, and what is new in World, each with a Try button.",
    steps: [
      "Press the Town Master beside the town board.",
      "Press Try on a new feature to see where it is.",
      "Untick Show this on start to stop the greeting.",
    ],
    place: "town",
    where: "Town, beside the town board at the top left",
    control: "town.master",
    since: "0.3.6",
    picture: { scene: "town", sizes: ["desktop"] },
  },
  {
    id: "town.apartments",
    title: "Apartments: finished agents",
    summary:
      "Agents that are not running live on in the apartment building beside the town center, asleep and resumable. Its sign says how many live there.",
    steps: [
      "Find the building beside the town center; press ALL if it is out of view.",
      "Press its green APARTMENTS sign.",
      "Search residents by name, project, summary, pull request or date.",
      "Open one to read its history; resume a Claude or Codex agent into a room, or evict it.",
    ],
    place: "town",
    where:
      "Town, the building beside the town center; also Apartments in the town center ring, and Past sessions in Board's hub",
    control: "town.apartments",
    since: "0.3.6",
    // On a phone the building is below the first view: ALL brings it in.
    picture: { scene: "town", press: [".town-zoom-all"] },
  },
];
