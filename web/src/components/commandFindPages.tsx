/**
 * Paging for the command box's finds (World's one search, #1355). A find
 * group is one page of a longer list (`ActionGroupDefinition.page`): rows
 * `from`.. of `total`. The box adds a Previous and a Next row that page
 * through the rest with the box left open, so every find stays reachable,
 * even ones no further word tells apart, while the list stays bounded.
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  ActionGroupDefinition,
  CommandExtension,
} from "./CommandCombobox";

/** The search's find groups from the `from`th find, each with its page rows. */
export function findPages(
  find: CommandExtension["find"],
  search: string,
  from: number,
  showFrom: (from: number) => void,
): ActionGroupDefinition[] {
  const group = search.trim() ? find?.(search, from) : null;
  return group ? [pagedFindGroup(group, showFrom)] : [];
}

/** The group with rows to the pages before and after it. */
function pagedFindGroup(
  group: ActionGroupDefinition,
  showFrom: (from: number) => void,
): ActionGroupDefinition {
  const { page } = group;
  if (!page) return group;
  const end = page.from + group.actions.length;
  const before = Math.max(0, page.from - page.size);
  const range = (from: number, to: number) =>
    from + 1 === to
      ? `${to} of ${page.total}`
      : `${from + 1}–${to} of ${page.total}`;
  return {
    ...group,
    actions: [
      ...(page.from > 0
        ? [
            {
              key: "find-page-previous",
              icon: <ChevronUp size={15} />,
              title: `Previous ${page.from - before}`,
              detail: range(before, page.from),
              score: 0.01,
              stay: true,
              run: () => showFrom(before),
            },
          ]
        : []),
      ...group.actions,
      ...(end < page.total
        ? [
            {
              key: "find-page-next",
              icon: <ChevronDown size={15} />,
              title: `Next ${Math.min(page.size, page.total - end)}`,
              detail: range(end, Math.min(end + page.size, page.total)),
              score: 0.01,
              stay: true,
              run: () => showFrom(end),
            },
          ]
        : []),
    ],
  };
}
