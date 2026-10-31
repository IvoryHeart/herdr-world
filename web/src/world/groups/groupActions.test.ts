import { expect, test } from "bun:test";
import { agentAddress, type Group } from "../../../../shared/groups";
import { buildGroupViews } from "../../../../shared/groupViews";
import {
  confirmedGroupOps,
  groupMemberEdit,
  groupPromotion,
  groupPrText,
  memberRef,
  selectedMemberRef,
} from "./groupActions";

const addr = agentAddress("connection-a", "builder");
const stored = (id: string, roles: string[] = []): Group => ({
  id,
  kind: "pod",
  name: id,
  created_at: 1,
  members: roles.length ? [{ ref: addr, roles, joined_at: 1 }] : [],
});
test("role transfer is a reviewable explicit plan and keeps actual browser attribution unknown", () => {
  const groups = buildGroupViews(
    [stored("Chat", ["lead", "reviewer"]), stored("Town")],
    [],
  );
  const plan = groupMemberEdit(groups[1]!, addr, ["builder"], groups);
  expect(plan.confirmation).toContain("Chat");
  expect(plan.ops[0]).not.toHaveProperty("replace");
  expect(confirmedGroupOps(plan)[0]).toMatchObject({
    replace: true,
    sender: { basis: "unknown", via: "browser" },
  });
});
test("projection roles and mismatched ref kinds are refused before a write", () => {
  const group = buildGroupViews([stored("Chat")], [])[0]!;
  expect(() =>
    groupMemberEdit(
      group,
      { connection_id: "connection-a", terminal_id: "terminal-1" },
      ["builder"],
      [],
    ),
  ).toThrow("address");
  expect(() =>
    groupMemberEdit(
      { ...group, stored: undefined, owner: "herdr" },
      addr,
      [],
      [],
    ),
  ).toThrow("Herdr");
});
test("UI promotion refuses away mappings rather than discarding members", () => {
  const team = buildGroupViews(
    [
      {
        ...stored("Pair"),
        kind: "team",
        members: [
          {
            ref: { connection_id: "connection-a", terminal_id: "terminal-1" },
            roles: [],
            joined_at: 1,
          },
        ],
      },
    ],
    [],
  )[0]!;
  expect(() => groupPromotion(team, "Chat", [])).toThrow("Every Team member");
});
test("unavailable PR sources cannot present a confirmed zero", () => {
  const group = buildGroupViews([stored("Chat")], [])[0]!;
  expect(groupPrText(group)).toBe("Open PRs unknown");
  expect(groupPrText({ ...group, workState: "stale" })).toBe(
    "0/2 open PRs · cached",
  );
});

test("choosing one terminal cannot create an ambiguous Pod address", () => {
  const pod = buildGroupViews([stored("Chat")], [])[0]!;
  const terminal = {
    connectionId: "connection-a",
    generation: 1,
    terminalId: "terminal-1",
    paneId: "pane-1",
    roomId: "room-1",
    deskId: "desk-1",
    name: "builder",
    status: "working",
  };
  const duplicate = { ...terminal, terminalId: "terminal-2", paneId: "pane-2" };
  expect(() => memberRef(pod, terminal, [terminal, duplicate])).toThrow(
    "rename",
  );
  expect(
    memberRef(pod, terminal, [
      terminal,
      { ...duplicate, connectionId: "connection-b" },
    ]),
  ).toBe(addr);
  expect(
    memberRef({ ...pod, kind: "team" }, terminal, [terminal, duplicate]),
  ).toEqual({
    connection_id: "connection-a",
    terminal_id: "terminal-1",
  });
});

test("a selected Pod address retains its name, generation and session witness", () => {
  const pod = buildGroupViews([stored("Chat")], [])[0]!;
  const selected = {
    connectionId: "connection-a",
    generation: 1,
    terminalId: "terminal-1",
    paneId: "pane-1",
    roomId: "room-1",
    deskId: "desk-1",
    name: "builder",
    status: "working",
    sessionFingerprint: "session-a",
  };
  for (const changed of [
    { name: "replacement" },
    { generation: 2 },
    { sessionFingerprint: "session-b" },
    { paneId: "pane-2" },
  ])
    expect(() =>
      selectedMemberRef(pod, selected, [{ ...selected, ...changed }]),
    ).toThrow("changed");
  expect(() => selectedMemberRef(pod, selected, [])).toThrow("current");
  expect(
    selectedMemberRef(pod, selected, [
      { ...selected, deskId: "desk-2", status: "idle" },
    ]),
  ).toBe(addr);
});
