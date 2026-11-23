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
    id: "town.center",
    title: "The town center's ring",
    summary:
      "Tap the town center to open a ring of actions around its doors: start an agent, talk to the Town master, focus, and more. Buildings opens a second ring with every place in Town.",
    steps: [
      "Tap the town center, or Tab to its plaque and press Enter.",
      "Choose an action, or Buildings to see Town's places.",
      "In Buildings, choose a place to open it, as tapping its building does.",
      "Press the centre arrow or Escape to go back; Escape again closes the ring.",
    ],
    place: "town",
    where: "Town, the domed building at the top of the town",
    control: "town.center",
    since: "0.3.6",
    picture: { scene: "town", press: ['[data-help-opens~="town.center"]'] },
  },
  {
    id: "town.focus",
    title: "Focus for a while",
    summary:
      "A focus session holds chimes, notifications and the tab count on every device while the crew keeps working. When it ends you hear one chime and get one recap.",
    steps: [
      "Open the town board from the chip in the top left corner.",
      "Under Focus, press 25 m, 45 m, 90 m or Until I stop.",
      "The chip shows headphones and the time left; press End now to stop early.",
      'When it ends, "While you focused" lists what arrived; each line opens Needs you.',
    ],
    place: "town",
    where:
      "Town, the town board at the top left; also the town center ring and Menu",
    control: "town.focus",
    since: "0.3.6",
    picture: { scene: "town", press: ['[data-help-opens~="town.focus"]'] },
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
  {
    id: "town.quiet",
    title: "Quiet agents",
    summary:
      "A working agent whose session has not moved for 10 minutes gets an hourglass with how long it has been quiet. The town board counts them under Busy.",
    steps: [
      "Open the town board and press the line under Busy, such as 2 quiet 10 m+.",
      "Town shows the first quiet agent; press Next to see the others.",
      "The hourglass goes as soon as the agent moves again.",
      "Change how long in Settings, Quiet working agents, or turn it off.",
    ],
    place: "town",
    where: "Town board, under Busy, while an agent is quiet",
    control: "town.quiet",
    since: "0.3.6",
    picture: { scene: "town", press: ['[data-help="town.board-chip"]'] },
  },
];
