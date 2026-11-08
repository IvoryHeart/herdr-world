/**
 * World's one search (#159): every view's search box finds hosts, rooms,
 * tables, agents and terminals with the same matching. A query is words;
 * each must appear, in any order and any case, somewhere in what an item is
 * called, where it is or what it is doing, as Pane Search matches.
 */

import { officeDeskLabel } from "./officeAgent";
import { officeDeskKey } from "./officeRoom";
import type {
  WorldAgentStatus,
  WorldLeafObject,
  WorldObject,
  WorldObjectNode,
  WorldSpaceObject,
} from "./worldObject";

/** A query's words, lowercased: each must match. */
export function worldSearchWords(query: string) {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether lowercased text has every word. No words matches nothing. */
export function worldTextMatches(text: string, words: readonly string[]) {
  return words.length > 0 && words.every((word) => text.includes(word));
}

export function worldNodeSearchText(node: WorldObjectNode) {
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return [
    node.label,
    node.hostLabel,
    node.connectionId,
    node.kind,
    leaf?.spaceLabel,
    leaf?.tabLabel,
    leaf?.status,
    leaf?.agentLabel,
    leaf?.agentName,
    leaf?.modelLabel,
    leaf?.taskSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

/** The observed nodes every word of the query matches, in World's order. */
export function worldSearchMatches(world: WorldObject, rawQuery: string) {
  const words = worldSearchWords(rawQuery);
  if (!words.length) return [];
  return world.nodes.filter((node) =>
    worldTextMatches(worldNodeSearchText(node), words),
  );
}

export type WorldSearchKind =
  | "building"
  | "room"
  | "table"
  | "agent"
  | "terminal";

/** Part of an excerpt; `match` parts are a query word. */
export type WorldSearchExcerptPart = { text: string; match: boolean };

export type WorldSearchResult = {
  /** Unique among results: the node's ID, or the table's desk key. */
  id: string;
  /** The node choosing the result selects (a table's first pane). */
  nodeId: string;
  kind: WorldSearchKind;
  label: string;
  /** Where it is, outermost first: building (its host), room, table. */
  place: string[];
  /** An agent's status; null for places and plain terminals. */
  status: WorldAgentStatus | null;
  stale: boolean;
  /** A task summary match, around the matched words. */
  excerpt: WorldSearchExcerptPart[] | null;
  /** 0: its name matches; 1: its name and place; 2: its task summary. */
  rank: number;
};

/** Characters of task summary shown around the first matched word. */
export const WORLD_SEARCH_EXCERPT = 72;

const lower = (parts: readonly (string | undefined)[]) =>
  parts.filter(Boolean).join(" ").toLocaleLowerCase();

/** A summary cut around its first matched word, the words picked out. */
export function worldSearchExcerpt(
  summary: string,
  words: readonly string[],
  length = WORLD_SEARCH_EXCERPT,
): WorldSearchExcerptPart[] {
  const text = summary.replace(/\s+/g, " ").trim();
  const folded = text.toLocaleLowerCase();
  const first = Math.min(
    ...words.map((word) => folded.indexOf(word)).filter((at) => at >= 0),
  );
  const anchor = Number.isFinite(first) ? first : 0;
  let start = Math.max(0, anchor - Math.floor(length / 3));
  const end = Math.min(text.length, start + length);
  start = Math.max(0, Math.min(start, end - length));
  // Mark every word inside the window, longest first where they overlap.
  const marked = new Array<boolean>(end - start).fill(false);
  for (const word of words) {
    let at = folded.indexOf(word, start);
    while (at >= 0 && at < end) {
      for (let i = at; i < Math.min(end, at + word.length); i += 1)
        marked[i - start] = true;
      at = folded.indexOf(word, at + Math.max(1, word.length));
    }
  }
  const parts: WorldSearchExcerptPart[] = [];
  if (start > 0) parts.push({ text: "…", match: false });
  for (let i = start; i < end; i += 1) {
    const match = marked[i - start]!;
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += text[i];
    else parts.push({ text: text[i]!, match });
  }
  if (end < text.length) parts.push({ text: "…", match: false });
  return parts;
}

function leafResult(
  leaf: WorldLeafObject,
  words: readonly string[],
): WorldSearchResult | null {
  const name = lower([
    leaf.label,
    leaf.agentLabel,
    leaf.agentName,
    leaf.modelLabel,
  ]);
  const besides = lower([
    name,
    leaf.hostLabel,
    leaf.connectionId,
    leaf.kind,
    leaf.spaceLabel,
    leaf.tabLabel,
    leaf.status,
  ]);
  const summary = (leaf.taskSummary ?? "").toLocaleLowerCase();
  if (!worldTextMatches(`${besides} ${summary}`, words)) return null;
  const fromSummary = words.some((word) => !besides.includes(word));
  return {
    id: leaf.id,
    nodeId: leaf.id,
    kind: leaf.kind,
    label: leaf.label,
    place: [leaf.hostLabel, leaf.spaceLabel, leaf.tabLabel].filter(
      (part): part is string => Boolean(part),
    ),
    status: leaf.kind === "agent" ? leaf.status : null,
    stale: leaf.stale,
    excerpt:
      fromSummary && leaf.taskSummary
        ? worldSearchExcerpt(
            leaf.taskSummary,
            words.filter((word) => summary.includes(word)),
          )
        : null,
    rank: fromSummary ? 2 : worldTextMatches(name, words) ? 0 : 1,
  };
}

function tableResults(
  space: WorldSpaceObject,
  words: readonly string[],
): WorldSearchResult[] {
  const results: WorldSearchResult[] = [];
  for (const tab of space.tabs) {
    const leaves = space.children.filter((leaf) => leaf.tabId === tab.tab_id);
    const label = officeDeskLabel(leaves, tab);
    const name = lower([label, tab.label]);
    if (
      !leaves[0] ||
      !worldTextMatches(
        lower([
          name,
          space.label,
          space.hostLabel,
          space.connectionId,
          "table",
        ]),
        words,
      )
    )
      continue;
    results.push({
      id: officeDeskKey(space.connectionId, tab.tab_id),
      nodeId: leaves[0].id,
      kind: "table",
      label,
      place: [space.hostLabel, space.label],
      status: null,
      stale: space.stale,
      excerpt: null,
      rank: worldTextMatches(name, words) ? 0 : 1,
    });
  }
  return results;
}

/**
 * The search's results: what each match is and where, names before places
 * before task summaries, otherwise in World's order.
 */
export function worldSearchResults(
  world: WorldObject,
  rawQuery: string,
): WorldSearchResult[] {
  const words = worldSearchWords(rawQuery);
  if (!words.length) return [];
  const results: WorldSearchResult[] = [];
  for (const host of world.hosts) {
    const hostName = host.label.toLocaleLowerCase();
    if (worldTextMatches(lower([host.label, host.connectionId, "host"]), words))
      results.push({
        id: host.id,
        nodeId: host.id,
        kind: "building",
        label: host.label,
        place: [],
        status: null,
        stale: host.stale,
        excerpt: null,
        rank: worldTextMatches(hostName, words) ? 0 : 1,
      });
    for (const space of host.spaces) {
      if (
        worldTextMatches(
          lower([space.label, space.hostLabel, space.connectionId, "room"]),
          words,
        )
      )
        results.push({
          id: space.id,
          nodeId: space.id,
          kind: "room",
          label: space.label,
          place: [space.hostLabel],
          status: null,
          stale: space.stale,
          excerpt: null,
          rank: worldTextMatches(space.label.toLocaleLowerCase(), words)
            ? 0
            : 1,
        });
      results.push(...tableResults(space, words));
      for (const leaf of space.children) {
        const result = leafResult(leaf, words);
        if (result) results.push(result);
      }
    }
  }
  // A stable sort keeps World's order within a rank.
  return results.sort((a, b) => a.rank - b.rank);
}
