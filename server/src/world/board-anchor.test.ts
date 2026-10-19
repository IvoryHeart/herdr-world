import { describe, expect, test } from "bun:test";
import { checkAnchor, type HerdrCall } from "./board-anchor";

const answering =
  (result: "ok" | Error): HerdrCall =>
  async () => {
    if (result instanceof Error) throw result;
    return { pane: {} };
  };

describe("Checking a Board anchor", () => {
  test("only Herdr's own not-found answer counts as absent", async () => {
    const current = () => true;
    expect(
      await checkAnchor(answering("ok"), {
        kind: "pane",
        native_id: "w1:p1",
        isCurrent: current,
      }),
    ).toEqual({ state: "present" });
    expect(
      await checkAnchor(
        answering(new Error("pane_not_found: pane w1:p1 not found")),
        { kind: "pane", native_id: "w1:p1", isCurrent: current },
      ),
    ).toEqual({ state: "absent" });
    expect(
      await checkAnchor(
        answering(new Error("tab_not_found: tab w1:t1 not found")),
        { kind: "tab", native_id: "w1:t1", isCurrent: current },
      ),
    ).toEqual({ state: "absent" });
    // A timeout or any other failure is not proof of absence.
    expect(
      await checkAnchor(answering(new Error("timed out")), {
        kind: "pane",
        native_id: "w1:p1",
        isCurrent: current,
      }),
    ).toEqual({ state: "unknown" });
    // A not-found for a different kind is not this anchor's answer.
    expect(
      await checkAnchor(
        answering(new Error("workspace_not_found: workspace w1 not found")),
        { kind: "pane", native_id: "w1:p1", isCurrent: current },
      ),
    ).toEqual({ state: "unknown" });
  });

  test("an answer from a retired runtime proves nothing", async () => {
    let calls = 0;
    const retiring = () => ++calls < 2;
    expect(
      await checkAnchor(
        answering(new Error("pane_not_found: pane w1:p1 not found")),
        { kind: "pane", native_id: "w1:p1", isCurrent: retiring },
      ),
    ).toEqual({ state: "unknown" });
    expect(
      await checkAnchor(answering("ok"), {
        kind: "pane",
        native_id: "w1:p1",
        isCurrent: () => false,
      }),
    ).toEqual({ state: "unknown" });
  });
});
