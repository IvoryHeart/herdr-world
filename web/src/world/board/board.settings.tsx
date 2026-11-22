/** Board controls share their stores with Settings and the command box. */

import { Activity, Palette, Presentation } from "lucide-react";
import { defineSettings } from "../../settings/registry";
import {
  boardAppearanceSnapshot,
  setBoardAppearance,
  subscribeBoardAppearance,
} from "./useBoardAppearance";
import {
  boardPulses,
  setBoardPulses,
  subscribeBoardPulses,
} from "./boardPulses";
import type { BoardSurface } from "./boardAppearance";
import { openViewControl } from "../../settings/viewControls";

const ON_BOARD = "Board: the ⋮ Board settings button";

defineSettings("board", [
  {
    kind: "setting",
    id: "board.surface",
    category: "town",
    title: "Board surface",
    description: "Follow the theme, or a whiteboard or blackboard",
    words: [
      "whiteboard",
      "blackboard",
      "chalkboard",
      "background",
      "board colour",
      "board color",
    ],
    icon: <Presentation size={15} />,
    scope: "browser",
    alsoOn: ON_BOARD,
    subscribe: subscribeBoardAppearance,
    control: {
      type: "choice",
      options: [
        { value: "theme", label: "Follow theme" },
        { value: "whiteboard", label: "Whiteboard" },
        { value: "blackboard", label: "Blackboard" },
      ],
      get: () => boardAppearanceSnapshot().surface,
      set: (_host, value) =>
        setBoardAppearance({
          ...boardAppearanceSnapshot(),
          surface: value as BoardSurface,
        }),
    },
  },
  {
    kind: "panel",
    id: "board.status-colours",
    category: "town",
    title: "Board status colours",
    description:
      "The colour of Needs you, Working, Finished, Idle and No signal",
    words: ["status colors", "card colours", "palette", "needs you colour"],
    icon: <Palette size={15} />,
    scope: "browser",
    alsoOn: `${ON_BOARD}, Status colours…`,
    open: () => openViewControl("board", "board.colours"),
  },
  {
    kind: "setting",
    id: "board.pulses",
    category: "town",
    title: "Board status pulses",
    description: "Cards pulse with their agent's status",
    words: ["pulse", "animation", "blink", "glow", "motion"],
    icon: <Activity size={15} />,
    scope: "browser",
    alsoOn: ON_BOARD,
    subscribe: subscribeBoardPulses,
    control: {
      type: "toggle",
      get: boardPulses,
      set: (_host, on) => setBoardPulses(on),
    },
  },
]);
