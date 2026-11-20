import type { HelpEntry } from "../../help/helpEntry";

/** Chat's help (web/src/help/helpEntry.ts): declared beside Chat's code. */
export const CHAT_HELP: readonly HelpEntry[] = [
  {
    id: "chat.composer",
    title: "Talk to an agent",
    summary:
      "Chat shows an agent's conversation as messages. Write to it here instead of typing into its terminal.",
    steps: [
      "Open an agent from Town or Board; Chat opens first.",
      "Write in the box at the bottom and press Send.",
      "Press ⋮ for the agent's commands and keys.",
    ],
    place: "chat",
    where: "Chat, the box at the bottom of an agent's window",
    control: "chat.composer",
    since: "0.2.7",
    picture: { scene: "chat" },
    firstRun: 3,
  },
  {
    id: "chat.speak",
    title: "Hear a reply",
    summary: "World reads an agent's reply aloud with your browser's voice.",
    steps: [
      "Point at a reply from the agent.",
      "Press the speaker beside Copy; press it again to stop.",
    ],
    place: "chat",
    where: "Chat, beside each reply's Copy button",
    control: "chat.speak",
    since: "0.3.0",
    picture: { scene: "chat" },
  },
];
