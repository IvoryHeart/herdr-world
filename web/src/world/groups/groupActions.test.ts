import { expect, test } from "bun:test";
import { agentAddress, type Group } from "../../../../shared/groups";
import { buildGroupViews } from "../../../../shared/groupViews";
import {
  confirmedGroupOps,
  groupMemberEdit,
  groupPromotion,
  groupPrText,
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
