import { expect, test } from "bun:test";
import { buildGroupViews } from "./groupViews";
import { agentAddress, type Group } from "./groups";
import { deriveGroupInterest } from "./groupInterest";
import { interestKey, type GroupInterest, type Interest } from "./interest";
import { DEFAULT_CHIMES, shouldChime } from "./chimes";

const key = interestKey("connection-a", "terminal-1");
const groups: Group[] = ["Chat", "Town"].map((id) => ({
  id,
  name: id,
  kind: "pod",
  created_at: 1,
  members: [
    {
      ref: agentAddress("connection-a", "reviewer"),
      roles: ["reviewer"],
      joined_at: 1,
    },
  ],
}));
const observation = {
  connectionId: "connection-a",
  generation: 1,
  current: true,
  rooms: [],
  desks: [],
  terminals: [
    {
      terminalId: "terminal-1",
      paneId: "pane-1",
      roomId: "room-1",
      deskId: "tab-1",
      name: "reviewer",
      status: "working",
    },
  ],
};

test("all 36 group/individual precedence combinations follow explicit agent > group Focus > Mute > Default", () => {
  const views = buildGroupViews(groups, [observation]);
  for (const first of [undefined, "muted", "focused"] as const)
    for (const second of [undefined, "muted", "focused"] as const)
      for (const explicit of [
        undefined,
        "watching",
        "muted",
        "focused",
      ] as const) {
        const intent: Record<string, GroupInterest> = {
          ...(first ? { Chat: first } : {}),
          ...(second ? { Town: second } : {}),
        };
        const individual: Record<string, Interest> = explicit
          ? { [key]: explicit }
          : {};
        const expected =
          explicit ??
          (first === "focused" || second === "focused"
            ? "focused"
            : first === "muted" || second === "muted"
              ? "muted"
              : "watching");
        expect(
          deriveGroupInterest(individual, intent, views).get(key)?.value ??
            "watching",
        ).toBe(expected);
      }
});
test("away or ambiguous names have no effective group interest and claims explain overrides", () => {
  const focused = { Chat: "muted" as const, Town: "focused" as const };
  expect(
    deriveGroupInterest({}, focused, buildGroupViews(groups, [])),
  ).toHaveLength(0);
  const ambiguous = {
    ...observation,
    terminals: [
      ...observation.terminals,
      {
        ...observation.terminals[0]!,
        terminalId: "terminal-2",
        paneId: "pane-2",
      },
    ],
  };
  expect(
    deriveGroupInterest({}, focused, buildGroupViews(groups, [ambiguous])),
  ).toHaveLength(0);
  expect(
    deriveGroupInterest(
      {},
      focused,
      buildGroupViews(groups, [observation]),
    ).get(key)?.description,
  ).toBe("Focused · via Pod · Town (Muted on Pod · Chat overridden)");
  expect(
    deriveGroupInterest(
      { [key]: "watching" },
      { Chat: "muted" },
      buildGroupViews(groups, [observation]),
    ).get(key)?.description,
  ).toContain("individual override");
});
test("effective policy reaches the actual Town-master mute/focus/motif/seen decision unchanged", () => {
  const views = buildGroupViews(groups, [observation]);
  for (const explicit of ["muted", "watching", "focused"] as const) {
    const interest = deriveGroupInterest(
      { [key]: explicit },
      { Chat: "focused" },
      views,
    ).get(key)!.value;
    const change = {
      motif: "needs_you" as const,
      townMaster: true,
      settings: DEFAULT_CHIMES,
      seen: false,
      interest,
      anyFocused: true,
    };
    expect(shouldChime(change)).toBe(explicit !== "muted");
    expect(shouldChime({ ...change, seen: true })).toBe(false);
    expect(
      shouldChime({
        ...change,
        settings: {
          ...DEFAULT_CHIMES,
          motifs: { ...DEFAULT_CHIMES.motifs, needs_you: false },
        },
      }),
    ).toBe(false);
  }
});
