/**
 * The command box's commands in the one registry (#1035 prototype). The box
 * builds its commands from what is open now (the focused workspace, tab and
 * pane, the window arrangement) and publishes them here, so Settings and its
 * search find "new workspace" as Cmd+K does. Each entry runs the box's own
 * action through the box, with the box's admission: an action the box
 * disables (a creation the active connection refuses) is disabled in
 * Settings with the same reason, and the entries go when the box unmounts
 * (another connection, Zen mode) rather than run against another one.
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { ActionGroupDefinition } from "../components/CommandCombobox";
import { settingsPrototypeOn } from "./flag";
import { type CommandEntry, defineSettings } from "./registry";
import { commandMatchScore } from "./search";

const SOURCE = "command-box";

type Published = {
  key: string;
  heading: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  shortcut?: string;
  keywords: string[];
  danger?: boolean;
  disabledReason: string | null;
  run: () => void;
};

/**
 * How the box ranks one of its commands for `search`, given its own filter's
 * score. With the prototype on, commands rank by the registry's one search,
 * as Settings ranks them; a looser match (a path, a part of a name) still
 * shows, below every match the one search makes.
 */
export function rankCommand(
  action: { title: string; detail?: string; keywords?: readonly string[] },
  search: string,
  filtered: number,
) {
  if (!settingsPrototypeOn()) return filtered;
  return commandMatchScore(action, search) || filtered * 0.5;
}

/** Groups that are results, not commands of the box's own. */
const NOT_COMMANDS = new Set(["Files", "Help"]);

/**
 * Publishes the box's command groups while the prototype is on and the box
 * can act. `results` are groups that are not commands of its own (World's
 * finds, settings from the registry); they and Files and Help are left out.
 */
export function useCommandBoxRegistry(
  allGroups: readonly ActionGroupDefinition[],
  results: readonly ActionGroupDefinition[],
  enabled: boolean,
  run: (action: () => void) => void,
) {
  const groups = allGroups.filter(
    (group) => !results.includes(group) && !NOT_COMMANDS.has(group.heading),
  );
  const on = settingsPrototypeOn();
  const latest = useRef(new Map<string, Published>());
  const published: Published[] = [];
  const seen = new Set<string>();
  if (on && enabled)
    for (const group of groups)
      for (const action of group.actions) {
        if (seen.has(action.key)) continue;
        seen.add(action.key);
        published.push({
          key: action.key,
          heading: group.heading,
          icon: action.icon,
          title: action.title,
          detail: action.detail,
          shortcut: action.shortcut,
          keywords: [...(action.keywords ?? []), group.heading],
          danger: action.danger,
          disabledReason: action.disabledReason ?? null,
          run: action.run,
        });
      }
  latest.current = new Map(published.map((item) => [item.key, item]));
  const runLatest = useRef(run);
  runLatest.current = run;
  // Publishes again only when what Settings shows changes, not each render.
  const signature = JSON.stringify(
    published.map((item) => [
      item.key,
      item.heading,
      item.title,
      item.detail ?? "",
      item.shortcut ?? "",
      item.keywords,
      !!item.danger,
      item.disabledReason ?? "",
    ]),
  );
  useEffect(() => {
    if (!on) return;
    const entries: CommandEntry[] = [...latest.current.values()].map(
      (item) => ({
        kind: "command",
        id: `command.${item.key}`,
        category: "commands",
        title: item.title,
        description: item.detail ?? item.heading,
        words: item.keywords,
        icon: item.icon,
        listedBy: SOURCE,
        danger: item.danger,
        shortcut: () => latest.current.get(item.key)?.shortcut ?? null,
        disabledReason: () =>
          latest.current.get(item.key)?.disabledReason ??
          (latest.current.has(item.key) ? null : "No longer available"),
        run: () => {
          const current = latest.current.get(item.key);
          if (!current || current.disabledReason) return;
          runLatest.current(current.run);
        },
      }),
    );
    defineSettings(SOURCE, entries);
  }, [on, signature]);
  useEffect(
    () => () => {
      if (on) defineSettings(SOURCE, []);
    },
    [on],
  );
}
