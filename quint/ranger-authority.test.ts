import { expect, test } from "bun:test";
import { replayRangerAuthority, type AuthorityState } from "./ranger-authority";
import { parseTrace } from "./traces";
function scenario(control?: string, boundary = "checking") {
  let authority: AuthorityState = {
    phase: "idle",
    permission: true,
    taskActive: true,
    serviceActive: true,
    runtimeCurrent: true,
    workspaceCurrent: true,
    writes: 0,
    result: "none",
  };
  const states = [{ op: "init", authority }];
  const append = (op: string, change: Partial<AuthorityState>) => {
    authority = { ...authority, ...change };
    states.push({ op, authority });
  };
  append("prepare", {});
  authority = { ...authority, phase: "prepared" };
  states[states.length - 1]!.authority = authority;
  const controls: Record<string, Partial<AuthorityState>> = {
    revoke: { permission: false },
    stopTask: { taskActive: false },
    dispose: { serviceActive: false },
    retire: { runtimeCurrent: false },
    replaceWorkspace: { workspaceCurrent: false },
  };
  if (boundary === "prepared" && control) append(control, controls[control]!);
  append("mutateInput", {});
  const early = !authority.runtimeCurrent || !authority.workspaceCurrent;
  append("execute", {
    phase: early ? "done" : "checking",
    result: early ? "failed" : "none",
  });
  if (!early) {
    if (boundary === "checking" && control) append(control, controls[control]!);
    const allowed =
      authority.permission &&
      authority.taskActive &&
      authority.serviceActive &&
      authority.runtimeCurrent &&
      authority.workspaceCurrent;
    append("checked", {
      phase: allowed ? "dispatch" : "done",
      result: allowed ? "none" : "failed",
    });
    if (allowed) {
      if (boundary === "dispatch" && control)
        append(control, controls[control]!);
      const send =
        authority.permission &&
        authority.taskActive &&
        authority.serviceActive &&
        authority.runtimeCurrent;
      append("release", {
        phase: "done",
        writes: send ? 1 : 0,
        result: send ? "succeeded" : "failed",
      });
    }
  }
  append("duplicate", {});
  return parseTrace("ranger-authority", JSON.stringify({ states }));
}
test("authorized action executes once with frozen preview input", async () => {
  expect((await replayRangerAuthority(scenario())).has("authorizedWrite")).toBe(
    true,
  );
});
for (const control of ["revoke", "stopTask", "dispose", "retire"])
  for (const boundary of ["checking", "dispatch"]) {
    test(`${control} during ${boundary} prevents the captured Ranger mutation`, async () => {
      const observed = await replayRangerAuthority(scenario(control, boundary));
      const witness: Record<string, string> = {
        revoke: "permissionBlocked",
        stopTask: "taskBlocked",
        dispose: "serviceBlocked",
        retire: "runtimeBlocked",
      };
      expect(observed.has(witness[control]!)).toBe(true);
    });
  }
test("workspace replacement after preview cannot reuse the captured action identity", async () => {
  expect(
    (await replayRangerAuthority(scenario("replaceWorkspace", "prepared"))).has(
      "workspaceBlocked",
    ),
  ).toBe(true);
});

test("invalid ranger-authority ordering fails before replay", () => {
  const states = scenario();
  expect(() =>
    parseTrace(
      "ranger-authority",
      JSON.stringify({ states: [states[0], { ...states[1], op: "release" }] }),
    ),
  ).toThrow("invalid Ranger action precondition");
});
