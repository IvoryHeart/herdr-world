import { expect, test } from "bun:test";
import { replayRangerRecovery, type RecoveryState } from "./ranger-recovery";
import { parseTrace } from "./traces";
function trace(replacement?: string) {
  let recovery: RecoveryState = {
    captured: false,
    saved: false,
    opened: true,
    loaded: false,
    endpoint: true,
    boot: true,
    workspace: true,
    generation: 1,
    recovered: false,
    result: "none",
  };
  const states = [{ op: "init", recovery }];
  const step = (op: string, change: Partial<RecoveryState>) => {
    recovery = { ...recovery, ...change };
    states.push({ op, recovery });
  };
  step("capture", { captured: true });
  step("save", { saved: true });
  step("failedSave", {});
  step("close", { opened: false });
  if (replacement === "runtime") step("runtimeReplacement", { generation: 3 });
  if (replacement === "endpoint")
    step("endpointReplacement", { endpoint: false });
  if (replacement === "boot") step("bootReplacement", { boot: false });
  if (replacement === "workspace")
    step("workspaceReplacement", { workspace: false });
  step("reopen", { opened: true, loaded: true });
  const accepted = !replacement || replacement === "runtime";
  step("recover", {
    result: accepted ? "accepted" : "rejected",
    recovered: accepted,
  });
  return parseTrace("ranger-recovery", JSON.stringify({ states }));
}
for (const replacement of [
  undefined,
  "runtime",
  "endpoint",
  "boot",
  "workspace",
]) {
  test(`committed admission survives SQL rollback/reopen and recovery checks ${replacement ?? "stable identity"}`, async () => {
    const observed = await replayRangerRecovery(trace(replacement));
    expect(observed.has("transactionFailure")).toBe(true);
    const expected: Record<string, string> = {
      runtime: "freshGeneration",
      endpoint: "endpointRejected",
      boot: "bootRejected",
      workspace: "workspaceRejected",
    };
    expect(
      observed.has(replacement ? expected[replacement]! : "stableRecovery"),
    ).toBe(true);
  });
}

test("invalid ranger-recovery ordering fails before replay", () => {
  const states = trace();
  expect(() =>
    parseTrace(
      "ranger-recovery",
      JSON.stringify({ states: [states[0], { ...states[1], op: "recover" }] }),
    ),
  ).toThrow("invalid recovery action precondition");
});
