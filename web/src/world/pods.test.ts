import { expect, test } from "bun:test";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import {
  parseRoundLabel,
  podOfTab,
  podRounds,
  podState,
  worldPods,
  type PodTabInput,
} from "./pods";
import { EMPTY_WORLD_SOURCES } from "./worldSources";

const tab = (key: string, label: string, room = "room-a"): PodTabInput => ({
  key,
  connectionId: "c",
  roomKey: room,
  label,
  panes: [{ paneId: `${key}-p`, generation: 1 }],
});

const pr = (number: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  key: `github:pr:example/repo#${number}`,
  source: "github",
  kind: "pull_request",
  ref: `example/repo#${number}`,
  title: `Change ${number}`,
  url: `https://example.com/example/repo/pull/${number}`,
  lane: "review",
  status: "open",
  roles: ["author"],
  updatedAt: 0,
  number,
  ...extra,
});

const sources = (
  items: WorkItem[],
  links: [string, WorkItem][] = [],
): WorldSourcesSnapshot => ({
  ...EMPTY_WORLD_SOURCES,
  items,
  links: links.map(([key, item]) => ({
    connectionId: "c",
    generation: 1,
    paneId: `${key}-p`,
    sessionFingerprint: null,
    itemKey: item.key,
    via: "branch" as const,
  })),
});

test("round labels name the pull request, branch and round", () => {
  expect(parseRoundLabel("#512 settings-sync · r2")).toEqual({
    number: 512,
    slug: "settings-sync",
    round: 2,
  });
  expect(parseRoundLabel("#7 · r1")).toEqual({
    number: 7,
    slug: null,
    round: 1,
  });
  expect(parseRoundLabel("#512 settings-sync")).toBeNull();
  expect(parseRoundLabel("notes · r2")).toBeNull();
});

test("a pod gathers its rounds in order and its linked author", () => {
  const item = pr(512);
  const [pod, ...rest] = worldPods(
    [
      tab("r2", "#512 settings-sync · r2"),
      tab("author", "builder", "room-b"),
      tab("r1", "#512 settings-sync · r1"),
      tab("loose", "docs"),
    ],
    sources([item], [["author", item]]),
  );
  expect(rest).toHaveLength(0);
  expect(pod!.rounds).toEqual([
    { round: 1, tabKey: "r1" },
    { round: 2, tabKey: "r2" },
  ]);
  expect(pod!.authorKeys).toEqual(["author"]);
  expect(pod!.item?.key).toBe(item.key);
  expect(pod!.state).toBe("reviewing");
  expect(podRounds(pod!)).toBe("r2 · +1 earlier");
  expect(podOfTab([pod!]).get("author")).toBe(pod);
});

test("without World sources a pod still has its rounds but no state", () => {
  const [pod] = worldPods([tab("r1", "#9 fix · r1")], EMPTY_WORLD_SOURCES);
  expect(pod).toMatchObject({ number: 9, item: null, state: null });
  expect(pod!.authorKeys).toEqual([]);
  expect(podRounds(pod!)).toBe("r1");
});

test("a pull request linked to the round wins over another repository's", () => {
  const ours = pr(9);
  const theirs = pr(9, { key: "github:pr:example/other#9" });
  const [pod] = worldPods(
    [tab("r1", "#9 fix · r1")],
    sources([theirs, ours], [["r1", ours]]),
  );
  expect(pod!.item?.key).toBe(ours.key);
  // Two candidates and no link: World cannot tell which one it is.
  const [unknown] = worldPods(
    [tab("r1", "#9 fix · r1")],
    sources([theirs, ours]),
  );
  expect(unknown!.item).toBeNull();
});

test("each room's round tabs are their own pod", () => {
  const pods = worldPods(
    [tab("a", "#3 x · r1", "room-a"), tab("b", "#3 x · r1", "room-b")],
    EMPTY_WORLD_SOURCES,
  );
  expect(pods).toHaveLength(2);
});

test("the plaque's state follows the pull request card", () => {
  expect(podState(pr(1, { lane: "merged" }))).toBe("merged");
  expect(podState(pr(1, { review: "changes_requested" }))).toBe("fixes");
  expect(podState(pr(1, { lane: "fixing" }))).toBe("fixes");
  expect(podState(pr(1))).toBe("reviewing");
});
