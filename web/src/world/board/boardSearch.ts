/**
 * Board's search (#159): the cards and rooms a query matches. Every word
 * matches, in any order, as World's search does (worldSearch.ts): a card on
 * its room, its name and each pane's searched text, task summary included,
 * so the cards agree with the results list.
 */

import {
  worldNodeSearchText,
  worldSearchWords,
  worldTextMatches,
} from "../worldSearch";
import type { BoardModel } from "./boardModel";

/** The matching card and room keys, or null when the query is empty. */
export function boardSearchMatches(model: BoardModel, query: string) {
  const words = worldSearchWords(query);
  if (!words.length) return null;
  const hit = new Set<string>();
  const spaceLabels = new Map(
    model.workspaces.map((space) => [space.key, space.label]),
  );
  for (const tab of model.tabs) {
    const text = [
      spaceLabels.get(tab.workspaceKey),
      tab.label,
      ...tab.panes.map((pane) => worldNodeSearchText(pane.leaf)),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (worldTextMatches(text, words)) {
      hit.add(tab.key);
      hit.add(tab.workspaceKey);
    }
  }
  for (const space of model.workspaces)
    if (worldTextMatches(space.label.toLocaleLowerCase(), words))
      hit.add(space.key);
  return hit;
}
