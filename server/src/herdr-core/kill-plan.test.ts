import { describe, expect, test } from "bun:test";
import {
  coreKillPlan,
  coreKillRefusal,
  type CoreKillConfirmation,
  type CoreKillPlan,
} from "./kill-plan";
import type { CoreMirrorTerminal } from "./mirror";

/**
 * What ends with a kill, as core cascades it (`record_finish` → `Orphaned`
 * here, `$/orphaned` on a linked machine, then that machine's own
 * `record_finish`). Records are shaped as core's mirror localizes them: a
 * parent here is bare, one on a machine is `<machine>/tN`.
 */

let pid = 40_000;
function record(
  address: string,
  fields: Partial<CoreMirrorTerminal> = {},
): CoreMirrorTerminal {
  return {
    address,
    labels: {},
    argv: ["/opt/example/bin/claude"],
    state: "live",
    pid: pid++,
    remote: address.includes("/"),
    ...fields,
  } as CoreMirrorTerminal;
}
const child = (
  address: string,
  parent: string,
  fields: Partial<CoreMirrorTerminal> = {},
) => record(address, { parent, die_with_parent: true, ...fields });

const confirmAll = (plan: CoreKillPlan): CoreKillConfirmation => ({
  coreId: plan.coreId,
  terminals: [...plan.roots, ...plan.descendants].map((e) => ({
    address: e.address,
    pid: e.pid,
    occupant: e.occupant,
    remote: e.remote,
  })),
});

describe("the planned cascade", () => {
  test("follows a chain onto a linked machine and on along it", () => {
    const terminals = [
      record("t1"),
      child("remote/t2", "t1"),
      child("remote/t3", "remote/t2"),
      child("remote/t4", "remote/t3", { die_with_parent: false }),
    ];
    const plan = coreKillPlan("core-a", terminals, ["t1"]);
    expect(plan.descendants.map((d) => [d.address, d.parent])).toEqual([
      ["remote/t2", "t1"],
      ["remote/t3", "remote/t2"],
    ]);
    // Confirming only what an earlier planner listed is not enough.
    const short = confirmAll(plan);
    short.terminals = short.terminals.filter((t) => t.address !== "remote/t3");
    expect(coreKillRefusal(plan, short)).toContain("would end too");
    expect(coreKillRefusal(plan, confirmAll(plan))).toBeNull();
  });

  test("a machine that calls this core by another name still names its parent", () => {
    const terminals = [
      record("t1"),
      // A machine's own terminal t1 is not this core's t1.
      record("remote/t1"),
      child("remote/t2", "home-alias/t1"),
      child("remote/t3", "remote/t1"),
    ];
    const plan = coreKillPlan("core-a", terminals, ["t1"]);
    expect(plan.descendants.map((d) => d.address)).toEqual(["remote/t2"]);
  });

  test("a local chain longer than any fixed depth is listed to its end", () => {
    const terminals = [record("t1")];
    for (let n = 2; n <= 68; n++) terminals.push(child(`t${n}`, `t${n - 1}`));
    const plan = coreKillPlan("core-a", terminals, ["t1"]);
    expect(plan.descendants).toHaveLength(67);
    expect(plan.descendants.at(-1)).toMatchObject({
      address: "t68",
      parent: "t67",
    });
  });

  test("descendants come depth first, in the order core holds them", () => {
    const terminals = [
      record("t1"),
      child("t2", "t1"),
      child("t3", "t1"),
      child("t4", "t2"),
      child("remote/t5", "t4"),
    ];
    const plan = coreKillPlan("core-a", terminals, ["t1"]);
    expect(plan.descendants.map((d) => d.address)).toEqual([
      "t2",
      "t4",
      "remote/t5",
      "t3",
    ]);
  });
});

describe("a confirmation holds only for the programs confirmed", () => {
  test("a replaced program on a linked machine refuses the kill", () => {
    const before = [record("t1"), child("remote/t2", "t1")];
    const confirmed = confirmAll(coreKillPlan("core-a", before, ["t1"]));
    // Kept: the sub-agent there was lost and its machine put a shell in.
    const after = [
      before[0]!,
      child("remote/t2", "t1", { argv: ["/bin/sh"], pid: 61_000 }),
    ];
    expect(
      coreKillRefusal(coreKillPlan("core-a", after, ["t1"]), confirmed),
    ).toContain("running a different program");
  });

  test("a replacement there that reuses the pid still refuses", () => {
    const before = [record("t1"), child("remote/t2", "t1")];
    const confirmed = confirmAll(coreKillPlan("core-a", before, ["t1"]));
    const after = [
      before[0]!,
      child("remote/t2", "t1", { argv: ["/bin/sh"], pid: before[1]!.pid }),
    ];
    expect(
      coreKillRefusal(coreKillPlan("core-a", after, ["t1"]), confirmed),
    ).toContain("running a different program");
  });
});
