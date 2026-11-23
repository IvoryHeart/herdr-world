import type { HelpEntry } from "../help/helpEntry";

/** Help for what works on every screen (web/src/help/helpEntry.ts). */
export const WORLD_HELP: readonly HelpEntry[] = [
  {
    id: "world.help",
    title: "What can I do here?",
    summary:
      "Every screen answers what you can do on it, with a picture and a Try button for each thing.",
    steps: [
      "Press ? beside the views, or open the views menu on a phone.",
      "Choose What can I do here?",
      "Press Try to see the control on screen.",
    ],
    place: "world",
    where: "Beside the views at the top; on a phone, the views button",
    control: "world.help",
    since: "0.3.6",
    picture: {
      scene: "town",
      press: ['[data-help-opens~="world.help"]'],
    },
    firstRun: 4,
  },
  {
    id: "world.command-box",
    title: "Find or act",
    summary:
      "One box finds agents, rooms and actions on every host and runtime, from every view.",
    steps: [
      "Press Ctrl+K (Cmd+K on a Mac) or the ⌘ button beside the views; on a phone, open the views menu and choose Find or act.",
      "Type a few letters of a name, room, machine, harness (Claude, Codex), status (needs you) or task, or of an action.",
      "Press Enter to open an agent's terminal or do the action; in Town, Board or Desk, Shift+Enter or the row's Show button shows it in that view instead.",
    ],
    place: "world",
    where: "Beside the views at the top; on a phone, in the views menu",
    control: "world.command-box",
    since: "0.3.0",
    picture: { scene: "town", sizes: ["desktop"] },
  },
  {
    id: "world.phone-hosts",
    title: "Hosts on a phone",
    summary:
      "On a phone, the views button also offers Hosts: choose which hosts World shows, or manage connections.",
    steps: [
      "Press the views button in the bottom corner.",
      "Choose Hosts, then tick the hosts to show.",
    ],
    place: "world",
    where: "On a phone, the views button in the bottom corner",
    control: "world.phone-hosts",
    since: "0.3.6",
    picture: {
      scene: "town",
      sizes: ["phone"],
      press: ['[data-help-opens~="world.phone-hosts"]'],
    },
  },
];
