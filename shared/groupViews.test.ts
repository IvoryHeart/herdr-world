import { describe, expect, test } from "bun:test";
import { agentAddress, type Group } from "./groups";
import {
  buildGroupViews,
  GROUP_STATUS_LABELS,
  projectedGroupId,
  type GroupConnectionObservation,
} from "./groupViews";
import type { WorkItem, WorkLink } from "./worldSources";

const connection = (id = "connection-a"): GroupConnectionObservation => ({
  connectionId: id,
  generation: 7,
  current: true,
  rooms: [{ id: "room-1", label: "Workshop" }],
  desks: [{ id: "tab-1", roomId: "room-1", label: "Review" }],
  terminals: [
    {
      terminalId: "terminal-1",
      paneId: "pane-1",
      roomId: "room-1",
      deskId: "tab-1",
      name: "builder",
      status: "working",
      sessionFingerprint: "session-a",
    },
  ],
});
const pod = (name = "Chat", members = ["builder"]): Group => ({
  id: name,
  kind: "pod",
  name,
  members: members.map((name) => ({
    ref: agentAddress("connection-a", name),
    roles: ["builder"],
    joined_at: 1,
  })),
  created_at: 1,
});
const pr = (key: string): WorkItem => ({
  key,
  source: "github",
  kind: "pull_request",
  ref: "example/project#1",
  title: "Example change",
  url: "https://github.com/example/project/pull/1",
  lane: "review",
  status: "OPEN",
  roles: ["author"],
  updatedAt: 1,
});
const link = (itemKey: string, patch: Partial<WorkLink> = {}): WorkLink => ({
  itemKey,
  connectionId: "connection-a",
  generation: 7,
  paneId: "pane-1",
  sessionFingerprint: "session-a",
  via: "branch",
  ...patch,
});

describe("Group read model", () => {
  test("projects Room desks and Desk terminals without changing stored refs", () => {
    const stored = [pod()];
    const before = structuredClone(stored);
    const views = buildGroupViews(stored, [
      connection(),
      connection("connection-b"),
    ]);
    const room = views.find(
      (view) => view.id === projectedGroupId("room", "connection-a", "room-1"),
    )!;
    const desk = views.find(
      (view) => view.id === projectedGroupId("desk", "connection-a", "tab-1"),
    )!;
    expect(room.owner).toBe("herdr");
    expect(room.members.map((member) => member.ref)).toEqual([
      { connection_id: "connection-a", tab_id: "tab-1" },
    ]);
    expect(desk.members.map((member) => member.ref)).toEqual([
      { connection_id: "connection-a", terminal_id: "terminal-1" },
    ]);
    expect(room.terminals).toHaveLength(1);
    expect(room.terminals[0]?.connectionId).toBe("connection-a");
    expect(views.filter((view) => view.kind === "room")).toHaveLength(2);
    expect(new Set(views.map((view) => view.key)).size).toBe(views.length);
    expect(stored).toEqual(before);
  });

  test("ignores stale, other-connection and ambiguous members in status", () => {
    const stale = { ...connection(), current: false };
    const group = pod();
    const away = buildGroupViews(
      [group],
      [stale, connection("connection-b")],
    )[0]!;
    expect(away.members[0]?.resolution).toBe("away");
    expect(away.status).toBe("unknown");
    expect(away.counts.working).toBe(0);
    const live = connection();
    live.terminals.push({
      ...live.terminals[0]!,
      terminalId: "terminal-2",
      paneId: "pane-2",
    });
    const ambiguous = buildGroupViews([group], [live])[0]!;
    expect(ambiguous.members[0]?.resolution).toBe("ambiguous");
    expect(ambiguous.members[0]?.matches).toHaveLength(2);
    expect(ambiguous.terminals).toHaveLength(0);
    expect(ambiguous.counts.working).toBe(0);
  });

  test("rolls up worst status and deduplicates shared terminal observations", () => {
    const observed = connection();
    observed.terminals.push(
      {
        ...observed.terminals[0]!,
        terminalId: "terminal-2",
        paneId: "pane-2",
        name: "lead",
        status: "blocked",
      },
      { ...observed.terminals[0]! },
    );
    const views = buildGroupViews(
      [pod("Chat", ["builder", "lead"]), pod("Platform")],
      [observed],
    );
    expect(views[0]?.status).toBe("needs_you");
    expect(views[0]?.counts).toMatchObject({ needs_you: 1, working: 1 });
    expect(views[0]?.terminals).toHaveLength(2);
    expect(views[1]?.terminals).toHaveLength(1);
  });

  test("counts only qualified current-session open PR links, once per PR", () => {
    const group = pod();
    group.attrs = { open_pr_limit: 1, queue: ["Review examples", "Ship"] };
    const merged = { ...pr("merged"), lane: "merged" as const };
    const items = [
      pr("a"),
      pr("b"),
      pr("old-runtime"),
      pr("old-session"),
      pr("other-host"),
      merged,
    ];
    const links = [
      link("a"),
      link("a"),
      link("b"),
      link("merged"),
      link("old-runtime", { generation: 6 }),
      link("old-session", { sessionFingerprint: "previous-session" }),
      link("other-host", { connectionId: "connection-b" }),
    ];
    const view = buildGroupViews([group], [connection()], { items, links })[0]!;
    expect(view.openPullRequests.map((item) => item.key)).toEqual(["a", "b"]);
    expect(view.openPrLimit).toBe(1);
    expect(view.overLimit).toBe(true);
    expect(view.now).toEqual(["Review examples", "Ship"]);
    expect(buildGroupViews([pod()], [connection()])[0]?.openPrLimit).toBe(2);
  });

  test("keeps cached Herdr projections visibly noncurrent without live rollups", () => {
    const views = buildGroupViews([], [{ ...connection(), current: false }]);
    expect(views).toHaveLength(2);
    expect(views.every((view) => view.current === false)).toBe(true);
    expect(views.every((view) => view.terminals.length === 0)).toBe(true);
    expect(views.every((view) => view.status === "unknown")).toBe(true);
  });

  test("exhausts the six-state worst-member roll-up order", () => {
    const statuses = Object.keys(GROUP_STATUS_LABELS);
    for (const [leftIndex, left] of statuses.entries()) {
      for (const [rightIndex, right] of statuses.entries()) {
        const owner = connection();
        owner.terminals[0] = {
          ...owner.terminals[0]!,
          name: "left",
          status: left,
        };
        owner.terminals.push({
          ...owner.terminals[0]!,
          terminalId: "terminal-2",
          paneId: "pane-2",
          name: "right",
          status: right,
        });
        const result = buildGroupViews(
          [pod("Pair", ["left", "right"])],
          [owner],
        )[0]!;
        expect(result.status).toBe(statuses[Math.min(leftIndex, rightIndex)]);
        expect(
          Object.values(result.counts).reduce((sum, count) => sum + count, 0),
        ).toBe(2);
      }
    }
  });

  test("unknown sessions match only equally unknown source observations", () => {
    const owner = connection();
    delete owner.terminals[0]!.sessionFingerprint;
    const result = buildGroupViews([pod()], [owner], {
      items: [pr("unknown"), pr("previous")],
      links: [link("unknown", { sessionFingerprint: null }), link("previous")],
    })[0]!;
    expect(result.openPullRequests.map((item) => item.key)).toEqual([
      "unknown",
    ]);
  });

  test("ambiguous occupants do not contribute either occupant's work", () => {
    const owner = connection();
    owner.terminals.push({
      ...owner.terminals[0]!,
      terminalId: "terminal-2",
      paneId: "pane-2",
    });
    const result = buildGroupViews([pod()], [owner], {
      items: [pr("first"), pr("second")],
      links: [link("first"), link("second", { paneId: "pane-2" })],
    })[0]!;
    expect(result.openPullRequests).toEqual([]);
  });

  test("Herdr room projection is independent of the stored 32-member cap", () => {
    const owner = connection();
    owner.desks = Array.from({ length: 40 }, (_, index) => ({
      id: `tab-${index}`,
      roomId: "room-1",
      label: `Desk ${index}`,
    }));
    const result = buildGroupViews([], [owner]).find(
      (view) => view.kind === "room",
    )!;
    expect(result.members).toHaveLength(40);
    expect(
      result.members.every((member) => member.resolution === "present"),
    ).toBe(true);
  });

  test("uses a separate view key even when a stored id resembles a projection", () => {
    const group = pod();
    group.id = projectedGroupId("room", "connection-a", "room-1");
    const views = buildGroupViews([group], [connection()]);
    expect(new Set(views.map((view) => view.key)).size).toBe(views.length);
  });
});
