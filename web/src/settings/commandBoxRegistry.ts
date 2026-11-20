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

/** Publishes `groups` while the prototype is on and the box can act. */
export function useCommandBoxRegistry(
  groups: readonly ActionGroupDefinition[],
  enabled: boolean,
  run: (action: () => void) => void,
) {
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
