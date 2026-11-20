/**
 * Focus (#1131) in the one registry: the command box (Cmd+K) and Settings'
 * search find "Focus 25 m" and "End focus now"; the Menu, the town center's
 * ring and the Town board offer the same through the Focus controls.
 */

import { Moon, MoonStar } from "lucide-react";
import { focusChoiceLabel } from "../../../shared/focus";
import { defineSettings, type CommandEntry } from "../settings/registry";
import { store } from "../store";
import {
  endFocus,
  focusChoices,
  focusHeld,
  openFocus,
  startFocus,
  subscribeFocus,
} from "./focus";

const WORDS = [
  "focus",
  "do not disturb",
  "dnd",
  "quiet",
  "hold notifications",
  "mute",
  "pomodoro",
  "deep work",
];

const failed = (error: unknown) =>
  store.notify({
    kind: "error",
    message: "Focus failed",
    detail: error instanceof Error ? error.message : String(error),
  });

const start = (minutes: number | null): CommandEntry => ({
  kind: "command",
  id: `focus.start-${minutes ?? "open"}`,
  category: "notifications",
  title: `Focus ${focusChoiceLabel(minutes).replace("Until I stop", "until I stop")}`,
  description:
    "Hold chimes, notifications and the tab count on every device, then get one recap",
  words: WORDS,
  icon: <Moon size={15} />,
  // The 1-minute choice is a testing switch (?focusTest=1).
  available: () => focusChoices().includes(minutes),
  subscribe: subscribeFocus,
  run: () => startFocus(minutes).catch(failed),
});

defineSettings("focus", [
  ...[1, 25, 45, 90, null].map(start),
  {
    kind: "command",
    id: "focus.end",
    category: "notifications",
    title: "End focus now",
    description: "End the focus session on every device",
    words: WORDS,
    icon: <MoonStar size={15} />,
    available: () => focusHeld(),
    subscribe: subscribeFocus,
    run: () => endFocus().catch(failed),
  },
  {
    kind: "panel",
    id: "focus.open",
    category: "notifications",
    scope: "world",
    title: "Focus",
    description: "Start a focus session, or see the time left",
    words: WORDS,
    icon: <Moon size={15} />,
    open: () => openFocus(),
  },
]);
