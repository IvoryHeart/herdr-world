/**
 * Settings and commands in the command box (#1035 prototype). The box asks
 * the registry's one search, so a word finds what the Settings screen finds;
 * a result changes the setting or runs the command at once: "night" offers
 * "Town time of day: Night", "font size" offers larger and smaller, "sounds"
 * turns sound on or off.
 */

import { Settings, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  ActionDefinition,
  ActionGroupDefinition,
} from "../components/CommandCombobox";
import { DEVTOOLS } from "../world/devtools/flag";
import { settingsPrototypeOn } from "./flag";
import { openSettings, useSettingsHost } from "./host";
import {
  entryShown,
  registryEntries,
  type RegistryEntry,
  type SettingsHost,
  subscribeRegistry,
} from "./registry";
import { type SettingsMatch, searchSettings } from "./search";

/** At most this many entries reach the box; the rest are one tap away. */
const LIMIT = 6;

function icon(entry: RegistryEntry) {
  return entry.icon ?? <SlidersHorizontal size={15} />;
}

/** The actions one match offers: each changes or runs something now. */
export function settingActions(
  match: SettingsMatch,
  host: SettingsHost,
): ActionDefinition[] {
  const { entry, score } = match;
  const keywords = [...(entry.words ?? [])];
  const base = { icon: icon(entry), keywords };
  if (entry.kind === "command")
    return [
      {
        ...base,
        key: `setting:${entry.id}`,
        title: entry.title,
        detail: entry.description,
        shortcut: entry.shortcut?.() ?? undefined,
        danger: entry.danger,
        score,
        run: () => void entry.run(host),
      },
    ];
  if (entry.kind === "panel")
    return [
      {
        ...base,
        key: `setting:${entry.id}`,
        title: entry.open ? `Open ${entry.title}` : entry.title,
        detail: entry.open ? entry.description : `On ${entry.alsoOn}`,
        score,
        run: () => (entry.open ? entry.open(host) : openSettings(entry.id)),
      },
    ];
  const control = entry.control;
  if (control.type === "toggle") {
    const on = control.get(host);
    return [
      {
        ...base,
        key: `setting:${entry.id}`,
        title: `${entry.title}: turn ${on ? "off" : "on"}`,
        detail: `Now ${on ? "on" : "off"}`,
        score,
        run: () => control.set(host, !on),
      },
    ];
  }
  if (control.type === "choice") {
    const current = control.get(host);
    // A named choice ("night") comes alone and first; otherwise every one.
    const options = match.option ? [match.option] : control.options;
    return options.map((option, index) => ({
      ...base,
      key: `setting:${entry.id}:${option.value}`,
      title: `${entry.title}: ${option.label}`,
      detail:
        option.value === current
          ? "Current"
          : entry.alsoOn
            ? `Also on ${entry.alsoOn}`
            : entry.description,
      keywords: [...keywords, option.label, ...(option.words ?? [])],
      score: score - index * 0.001,
      disabledReason: option.value === current ? "Already chosen" : null,
      run: () => control.set(host, option.value),
    }));
  }
  if (control.type === "stepper") {
    const value = control.get(host);
    const larger = Math.min(control.max, value + control.step);
    const smaller = Math.max(control.min, value - control.step);
    return [
      {
        ...base,
        key: `setting:${entry.id}:up`,
        title: `${entry.title}: larger`,
        detail: `${control.format(value)} → ${control.format(larger)}`,
        score,
        disabledReason: larger === value ? "Already the largest" : null,
        run: () => control.set(host, larger),
      },
      {
        ...base,
        key: `setting:${entry.id}:down`,
        title: `${entry.title}: smaller`,
        detail: `${control.format(value)} → ${control.format(smaller)}`,
        score: score - 0.001,
        disabledReason: smaller === value ? "Already the smallest" : null,
        run: () => control.set(host, smaller),
      },
    ];
  }
  return [
    {
      ...base,
      key: `setting:${entry.id}`,
      title: `${entry.title}…`,
      detail: "Change it in Settings",
      score,
      run: () => openSettings(entry.id),
    },
  ];
}

const OPEN_SETTINGS: Omit<ActionDefinition, "score"> = {
  key: "settings-open",
  icon: <Settings size={15} />,
  title: "Open Settings",
  detail: "Every setting and command, with search",
  keywords: ["settings", "preferences", "configuration", "options"],
  run: () => openSettings(),
};

/** The groups the box shows for a search; none while the flag is off. */
export function settingsCommandGroups(
  entries: readonly RegistryEntry[],
  host: SettingsHost | null,
  search: string,
): ActionGroupDefinition[] {
  if (!host) return [];
  if (!search.trim())
    return [{ heading: "Settings", actions: [OPEN_SETTINGS] }];
  const shown = entries.filter((entry) => entryShown(entry, host, DEVTOOLS));
  const matches = searchSettings(shown, search).slice(0, LIMIT);
  const settings = matches
    .filter((match) => match.entry.kind !== "command")
    .flatMap((match) => settingActions(match, host));
  const commands = matches
    .filter((match) => match.entry.kind === "command")
    .flatMap((match) => settingActions(match, host));
  return [
    { heading: "Settings", actions: [...settings, OPEN_SETTINGS] },
    { heading: "Commands", actions: commands },
  ].filter((group) => group.actions.length > 0);
}

/** For the command box: the groups, loading the registry when the flag is on. */
export function useSettingsCommandGroups(search: string) {
  const on = settingsPrototypeOn();
  useEffect(() => {
    if (on) void import("./catalog");
  }, [on]);
  const entries = useSyncExternalStore(
    subscribeRegistry,
    registryEntries,
    registryEntries,
  );
  const host = useSettingsHost();
  return useMemo(
    () => (on ? settingsCommandGroups(entries, host, search) : []),
    [on, entries, host, search],
  );
}
