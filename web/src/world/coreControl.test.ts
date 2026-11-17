import { describe, expect, test } from "bun:test";
import {
  coreKillConfirmation,
  coreKillDescendantsText,
  parseCoreKillPlan,
} from "./coreControl";
import { isCoreAppSpace } from "./coreRooms";

/** A plan as world.core.kill_plan sends it (server/src/herdr-core/operations.ts). */
const sent = {
  core_id: "core-1",
  roots: [
    {
      address: "t1",
      pid: 101,
      occupant: "p1",
      name: "lead",
      remote: false,
      label: "lead",
      room: "Review",
    },
  ],
  descendants: [
    {
      address: "t2",
      pid: 102,
      occupant: "p2",
      parent: "t1",
      name: null,
      remote: false,
      label: "codex",
      room: "Review",
    },
    {
      address: "t7",
      pid: null,
      parent: "t1",
      name: "helper",
      remote: true,
      label: "helper",
    },
  ],
};

describe("a core kill plan in the browser", () => {
  test("is confirmed exactly as shown, linked-machine terminals included", () => {
    const plan = parseCoreKillPlan(sent);
    expect(coreKillConfirmation(plan)).toEqual({
      core_id: "core-1",
      terminals: [
        { address: "t1", pid: 101, occupant: "p1" },
        { address: "t2", pid: 102, occupant: "p2" },
        { address: "t7", pid: null, occupant: null, remote: true },
      ],
    });
  });

  test("names everything that ends with it and where", () => {
    expect(coreKillDescendantsText(parseCoreKillPlan(sent))).toEqual([
      "codex (in Review)",
      "helper (on a linked machine)",
    ]);
  });

  test("a reply without a core is not a plan; bad entries are dropped", () => {
    expect(() => parseCoreKillPlan({ roots: [] })).toThrow();
    expect(
      parseCoreKillPlan({
        core_id: "c",
        roots: [{ pid: 1 }, null],
        descendants: "x",
      }),
    ).toEqual({ core_id: "c", roots: [], descendants: [] });
  });

  test("only the app's spaces are the app's", () => {
    expect(isCoreAppSpace("hc:space:s1")).toBe(true);
    expect(isCoreAppSpace("hc:unplaced")).toBe(false);
    expect(isCoreAppSpace("hc:room:r0123456789ab")).toBe(false);
  });
});
