/**
 * Town's and the views' settings in the one registry (#1035). Town owns this
 * file; the Settings screen, its search and the command box find these
 * without knowing Town. Values stay where they are kept today: the
 * time-of-day button's choice (townDaylight.ts) and the view preferences
 * (officePreferences.ts), so the button and this list never disagree.
 */

import {
  Building2,
  Bug,
  Columns3,
  Focus,
  Hand,
  Hourglass,
  Layers,
  MessageSquare,
  SunMoon,
  UserRound,
  Wind,
} from "lucide-react";
import { worldLocalStorage } from "../../browserStorage";
import { defineSettings } from "../../settings/registry";
import { openViewControl } from "../../settings/viewControls";
import { requestTrace, traceRemembered } from "../devtools/trace";
import {
  type OfficePreferences,
  readOfficePreferences,
  townRoomsPerRow,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
} from "../officePreferences";
import {
  setTownDaylightMode,
  subscribeTownDaylight,
  type TownDaylightMode,
  townDaylightMode,
} from "./townDaylight";
import { TOWN_QUIET_MINUTES } from "./townQuietWork";

const preferences = () => readOfficePreferences(worldLocalStorage);

/** Writes one view preference and tells the views, as the Menu did. */
function updatePreferences(patch: Partial<OfficePreferences>) {
  const next = writeOfficePreferences(worldLocalStorage, {
    ...preferences(),
    ...patch,
  });
  window.dispatchEvent(
    new CustomEvent<OfficePreferences>(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, {
      detail: next,
    }),
  );
}

function subscribePreferences(listener: () => void) {
  window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, listener);
  return () =>
    window.removeEventListener(
      WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
      listener,
    );
}

defineSettings("town", [
  {
    kind: "setting",
    id: "town.time-of-day",
    category: "town",
    title: "Town time of day",
    description: "Follows your clock, or holds day, dusk or night",
    words: [
      "lighting",
      "light",
      "daylight",
      "sky",
      "sun",
      "moon",
      "dark",
      "evening",
      "clock",
    ],
    icon: <SunMoon size={15} />,
    scope: "browser",
    alsoOn: "Town: the sun button under ALL",
    subscribe: subscribeTownDaylight,
    control: {
      type: "choice",
      options: [
        {
          value: "clock",
          label: "Follow my clock",
          words: ["clock", "auto", "real time"],
        },
        { value: "day", label: "Day", words: ["noon", "bright", "daytime"] },
        { value: "dusk", label: "Dusk", words: ["evening", "sunset"] },
        { value: "night", label: "Night", words: ["dark", "midnight"] },
      ],
      get: () => townDaylightMode(),
      set: (_host, value) => setTownDaylightMode(value as TownDaylightMode),
    },
  },
  {
    kind: "setting",
    id: "town.calm-motion",
    category: "town",
    title: "Calm motion",
    description: "Less ambient motion in Town and shorter camera moves",
    words: ["reduce motion", "animation", "movement", "town calm"],
    icon: <Wind size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "toggle",
      get: () => preferences().townCalm,
      set: (_host, on) => updatePreferences({ townCalm: on }),
    },
  },
  {
    kind: "setting",
    id: "town.quiet-agents",
    category: "town",
    title: "Quiet working agents",
    description:
      "Mark a working agent whose session has not moved for this long",
    words: [
      "quiet",
      "stuck",
      "hung",
      "stalled",
      "no progress",
      "hourglass",
      "threshold",
      "idle working",
    ],
    icon: <Hourglass size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "choice",
      options: TOWN_QUIET_MINUTES.map((minutes) =>
        minutes === 0
          ? { value: "0", label: "Off", words: ["never", "disable"] }
          : { value: String(minutes), label: `${minutes} minutes` },
      ),
      get: () => String(preferences().townQuietMinutes),
      set: (_host, value) =>
        updatePreferences({ townQuietMinutes: Number(value) }),
    },
  },
  {
    kind: "setting",
    id: "town.buildings",
    category: "town",
    title: "Town buildings",
    description:
      "One building per machine with every runtime's rooms, or one per runtime",
    words: [
      "buildings",
      "layout",
      "host",
      "machine",
      "runtime",
      "herdr-core",
      "herdr-tui",
      "separate buildings",
    ],
    icon: <Building2 size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "choice",
      options: [
        {
          value: "host",
          label: "One per machine",
          words: ["machine", "merged"],
        },
        {
          value: "runtime",
          label: "One per runtime",
          words: ["separate", "herdr-core", "herdr-tui"],
        },
      ],
      get: () => preferences().townBuildings,
      set: (_host, value) =>
        updatePreferences({
          townBuildings: value as OfficePreferences["townBuildings"],
        }),
    },
  },
  {
    kind: "setting",
    id: "town.rooms-per-row",
    category: "town",
    title: "Rooms per row",
    description:
      "Auto keeps each building about square; a number sets every building",
    words: [
      "rooms per row",
      "columns",
      "building shape",
      "square",
      "tower",
      "layout",
      "auto",
    ],
    icon: <Columns3 size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "choice",
      options: [
        { value: "auto", label: "Auto", words: ["square", "automatic"] },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
      ],
      get: () => String(preferences().townRoomsPerRow),
      set: (_host, value) =>
        updatePreferences({
          townRoomsPerRow: townRoomsPerRow(
            value === "auto" ? value : Number(value),
          ),
        }),
    },
  },
  {
    kind: "setting",
    id: "views.agents-open",
    category: "town",
    title: "Opening an agent shows",
    description: "In Town, Board and Desk: its Chat, or its terminal",
    words: ["agents open", "default view", "chat or terminal"],
    icon: <MessageSquare size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "choice",
      options: [
        { value: "chat", label: "Chat" },
        { value: "terminal", label: "Terminal", words: ["shell"] },
      ],
      get: () => preferences().townOpens,
      set: (_host, value) =>
        updatePreferences({
          townOpens: value as OfficePreferences["townOpens"],
        }),
    },
  },
  {
    kind: "setting",
    id: "views.inspector-opening",
    category: "town",
    title: "Inspector opens",
    description: "Where a newly opened agent or room appears on wide screens",
    words: ["inspector opening", "dock", "floating window", "snap right"],
    icon: <Focus size={15} />,
    scope: "browser",
    platform: "desktop",
    subscribe: subscribePreferences,
    control: {
      type: "choice",
      options: [
        { value: "docked", label: "Snapped right", words: ["docked"] },
        { value: "floating", label: "Floating", words: ["window"] },
      ],
      get: () => preferences().inspectorPresentation,
      set: (_host, value) =>
        updatePreferences({
          inspectorPresentation:
            value as OfficePreferences["inspectorPresentation"],
        }),
    },
  },
  {
    kind: "setting",
    id: "town.master",
    category: "town",
    title: "Town master",
    description:
      "The agent whose Chat Town docks from the start; empty docks none",
    words: ["firstmate", "first mate", "dock chat", "main agent"],
    icon: <UserRound size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "text",
      maxLength: 64,
      placeholder: "Agent name",
      get: () => preferences().townMaster,
      set: (_host, value) => updatePreferences({ townMaster: value }),
    },
  },
  {
    kind: "setting",
    id: "town.greeting",
    category: "town",
    title: "Town master greeting",
    description: "Hello and what changed since you left, on each visit",
    words: ["welcome", "since you left", "show on start"],
    icon: <Hand size={15} />,
    scope: "browser",
    subscribe: subscribePreferences,
    control: {
      type: "toggle",
      get: () => preferences().townGreeting,
      set: (_host, on) => updatePreferences({ townGreeting: on }),
    },
  },
  {
    // Town's lens is chosen on Town and starts in Attention on every visit,
    // so Settings takes you to the chooser rather than holding a value.
    kind: "panel",
    id: "town.lenses",
    category: "town",
    title: "Town lenses",
    description:
      "Tint Town by idle time, spend, pull requests, quests or harness",
    words: [
      "lens",
      "overlay",
      "tint",
      "heat map",
      "idle time",
      "spend",
      "cost",
      "pull requests",
      "quests",
      "harness",
    ],
    icon: <Layers size={15} />,
    alsoOn: "Town: L, or the Lenses action on the ring",
    open: () => openViewControl("town", "town.lenses"),
  },
  {
    kind: "setting",
    id: "town.event-trace",
    category: "town",
    title: "Town event trace",
    description: "Development builds: record Town's input for a bug report",
    words: ["debug", "devtools", "trace"],
    icon: <Bug size={15} />,
    scope: "browser",
    dev: true,
    control: {
      type: "toggle",
      get: () => traceRemembered("town"),
      set: (_host, on) => requestTrace("town", on),
    },
  },
]);
