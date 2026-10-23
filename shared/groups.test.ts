import { describe, expect, test } from "bun:test";
import {
  agentAddress,
  checkStoredGroups,
  parseGroupRef,
  resolveGroupRef,
  type Group,
} from "./groups";
import {
  closedRelations,
  joinGroup,
  leaveGroups,
  relationsOf,
} from "./relations";

const ref = "agent://studio/peek";
const pod = (id: string, roles: string[]): Group => ({
  id,
  kind: "pod",
  name: id,
  created_at: 1,
  members: [{ ref, roles, joined_at: 1 }],
});
const observed = (terminal_id: string, extra = {}) => ({
  connection_id: "studio",
  terminal_id,
  name: "peek",
  current: true,
  ...extra,
});

describe("Group membership properties", () => {
  test("exhaustively pools lead/builder exclusivity across pods, with shared reviewers", () => {
    const roles = [
      [],
      ["reviewer"],
      ["lead"],
      ["builder"],
      ["lead", "builder"],
      ["reviewer", "builder"],
    ];
    for (const left of roles)
      for (const right of roles) {
        const exclusive = (value: string[]) =>
          value.includes("lead") || value.includes("builder");
        const check = () =>
          checkStoredGroups([pod("a", left), pod("b", right)]);
        if (exclusive(left) && exclusive(right))
          expect(check).toThrow("one pod");
        else expect(check).not.toThrow();
      }
    const remote = pod("remote", ["lead"]);
    remote.members[0]!.ref = "agent://remote/peek";
    expect(() =>
      checkStoredGroups([pod("a", ["builder"]), remote]),
    ).not.toThrow();
  });

  test("an address follows a restarted occupant; never guesses another name, host or stale observation", () => {
    expect(resolveGroupRef(ref, [observed("old")])).toEqual({
      state: "present",
      terminal: { connection_id: "studio", terminal_id: "old" },
    });
    expect(resolveGroupRef(ref, [observed("new")])).toEqual({
      state: "present",
      terminal: { connection_id: "studio", terminal_id: "new" },
    });
    for (const agents of [
      [],
      [observed("old", { current: false })],
      [observed("other", { name: "firstmate" })],
      [observed("other", { connection_id: "remote" })],
      [observed("case", { connection_id: "Studio" })],
    ]) {
      expect(resolveGroupRef(ref, agents)).toEqual({ state: "away" });
    }
    expect(resolveGroupRef(ref, [observed("a"), observed("b")])).toEqual({
      state: "ambiguous",
      matches: [
        { connection_id: "studio", terminal_id: "a" },
        { connection_id: "studio", terminal_id: "b" },
      ],
    });
  });

  test("canonical addresses preserve case and escaping, and cannot alias terminal refs", () => {
    expect(parseGroupRef("agent://Studio/%70eek")).toBe("agent://Studio/peek");
    expect(parseGroupRef(agentAddress("Studio", "review / A"))).toBe(
      "agent://Studio/review%20%2F%20A",
    );
    for (const value of [
      "https://studio/peek",
      "agent://studio/peek/other",
      "agent://studio/peek?x",
      "agent://studio/%00",
      "agent://studio/%zz",
    ]) {
      expect(() => parseGroupRef(value)).toThrow();
    }
  });

  test("pods and custom kinds never magnetize or prune; team operations leave them intact", () => {
    const saved = pod("pod", ["reviewer"]);
    const custom: Group = {
      id: "guild",
      kind: "guild",
      created_at: 1,
      members: [
        {
          ref: { connection_id: "studio", terminal_id: "old" },
          roles: ["captain"],
          joined_at: 1,
        },
      ],
    };
    const groups = [saved, custom];
    expect(relationsOf({ spawns: [], groups }, [])).toEqual([]);
    expect(
      closedRelations({ spawns: [], groups }, [
        {
          connection_id: "studio",
          generation: 2,
          current: true,
          complete: true,
          panes: [],
        },
      ]),
    ).toEqual({ children: [], members: [] });
    const terminal = { connection_id: "studio", terminal_id: "old" };
    expect(leaveGroups(groups, [terminal])).toEqual(groups);
    const joined = joinGroup(
      groups,
      [terminal],
      [{ connection_id: "studio", terminal_id: "new" }],
      "team",
      2,
    );
    expect(joined.slice(0, 2)).toEqual(groups);
  });
});
