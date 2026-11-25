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
    since: "0.3.7",
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
      "One search finds agents, rooms and actions on every host and runtime, from every view.",
    steps: [
      "Press /, Ctrl+F or Ctrl+K (Cmd+K on a Mac), or a view's search button; on a phone, open the views menu and choose Find or act.",
      "Type a few letters of a name, room, machine, harness (Claude Code, Codex), status (needs you) or task, or of an action such as new workspace.",
      "Press Enter to go to it in the view you are in, or to do the action; Shift+Enter or the row's Open terminal button opens its terminal instead.",
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
    since: "0.3.7",
    picture: {
      scene: "town",
      sizes: ["phone"],
      press: ['[data-help-opens~="world.phone-hosts"]'],
    },
  },
];
