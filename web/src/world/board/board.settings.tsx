/**
 * Board's settings in the one registry (#1035). Board keeps its surface,
 * status colours and pulses in its own settings menu, read when Board opens;
 * until they gain a shared store (a later slice), Settings and the command
 * box find them here and open Board's menu or dialog, where they change.
 */

import { Activity, Palette, Presentation } from "lucide-react";
import { defineSettings } from "../../settings/registry";
import { openViewControl } from "../../settings/viewControls";

const ON_BOARD = "Board: the ⋮ Board settings button";

defineSettings("board", [
  {
    kind: "panel",
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
    open: () => openViewControl("board", "board.settings"),
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
    kind: "panel",
    id: "board.pulses",
    category: "town",
    title: "Board status pulses",
    description: "Cards pulse with their agent's status",
    words: ["pulse", "animation", "blink", "glow", "motion"],
    icon: <Activity size={15} />,
    scope: "browser",
    alsoOn: ON_BOARD,
    open: () => openViewControl("board", "board.settings"),
  },
]);
