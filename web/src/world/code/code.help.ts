import type { HelpEntry } from "../../help/helpEntry";

/** The Code view's help (web/src/help/helpEntry.ts): declared beside its code. */
export const CODE_HELP: readonly HelpEntry[] = [
  {
    id: "code.project",
    title: "Your VS Code in World",
    summary:
      "Code shows the VS Code installed on the computer a project is on, this one or an SSH host, inside World. The project's agents and terminals stay beside it.",
    steps: [
      "Choose Code beside the views; on a phone, in the views menu.",
      "Pick a project in the bar at the top.",
      "Press Open; the first time, enable an IDE there first.",
      "Use the button at the bar's right end to show or hide the project's agents and terminals.",
    ],
    place: "code",
    where: "Code, the project picker at the left of its top bar",
    control: "code.project",
    since: "0.3.6",
    picture: { scene: "code" },
  },
];
