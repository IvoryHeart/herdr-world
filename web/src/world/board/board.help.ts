import type { HelpEntry } from "../../help/helpEntry";

/** Board's help (web/src/help/helpEntry.ts): declared beside Board's code. */
export const BOARD_HELP: readonly HelpEntry[] = [
  {
    id: "board.next",
    title: "Next agent needing you",
    summary:
      "Board lays out every host, room and agent as cards. Next opens the next agent that needs you, shared questions too.",
    steps: [
      "Press Next in Board's controls.",
      "Answer or look, then press Next again for the one after.",
    ],
    place: "board",
    where: "Board, the controls along the top",
    control: "board.next",
    since: "0.3.0",
    picture: { scene: "board" },
    firstRun: 2,
  },
  {
    id: "board.lenses",
    title: "Lenses",
    summary:
      "A lens colours every card by one question: idle time, spending, pull requests, quests or harness.",
    steps: [
      "Press Lenses, or the L key.",
      "Choose a lens; the legend explains its colours.",
      "Press the lens's name again to leave it.",
    ],
    place: "board",
    where: "Board, the controls along the top",
    control: "board.lenses",
    since: "0.3.0",
    // Narrow screens keep Lenses in Board's settings menu.
    picture: { scene: "board", press: ['[data-help-opens~="board.lenses"]'] },
  },
  {
    id: "board.camera",
    title: "Find your way around Board",
    summary:
      "Board is a map of every host, workspace and tab. Pan, zoom and fit it like a map.",
    steps: [
      "Drag the empty board to pan.",
      "Pinch, scroll or use + and − to zoom.",
      "Press Fit to see everything.",
    ],
    place: "board",
    where: "Board, the zoom buttons in the controls along the top",
    control: "board.camera",
    since: "0.2.6",
    picture: { scene: "board" },
  },
  {
    id: "board.arrange",
    title: "Arrange cards and move panes",
    summary:
      "Cards stay where you put them. Dragging a pane row onto another tab moves only that pane, on the same host.",
    steps: [
      "Drag a card to place it.",
      "Drag a pane row onto another tab to move that pane.",
      "On a phone, hold a card or pane row to lift it; a quick swipe pans.",
    ],
    place: "board",
    where: "Board, any card",
    control: "board.surface",
    since: "0.3.0",
    picture: { scene: "board" },
  },
  {
    id: "board.add",
    title: "Add memory, logs, docs and links",
    summary:
      "Add to Board places a project's memory, a past agent's log, a document or a link on the board as a card you can open and read.",
    steps: [
      "Press Add to Board in Board's controls.",
      "Pick a kind, then choose what it shows.",
      "Press the card to read it beside the board.",
    ],
    place: "board",
    where: "Board, the controls along the top",
    control: "board.add",
    since: "0.3.6",
    // Narrow screens keep Add to Board in Board's settings menu.
    picture: { scene: "board", press: ['[data-help-opens~="board.add"]'] },
  },
  {
    id: "board.notes",
    title: "Notes for agents",
    summary:
      "Write a note on the board, connect it to an agent, and send it when it is ready.",
    steps: [
      "Double-click the empty board to start a note.",
      "Drag the note's handle onto an agent to connect it.",
      "Press Send when the note is ready.",
    ],
    place: "board",
    where: "Board, anywhere on the empty board",
    control: "board.surface",
    since: "0.2.6",
    picture: { scene: "board" },
  },
];
