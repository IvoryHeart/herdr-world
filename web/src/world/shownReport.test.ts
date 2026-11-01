import { expect, test } from "bun:test";
import { markShownReport } from "./shownReport";
import type { WorldLeafObject } from "./worldObject";

const leaf = { id: "local:agent:w1:p1" } as unknown as WorldLeafObject;

test("Town's Mark reviewed toasts success only once the service saved the mark", async () => {
  const toasts: [string, string][] = [];
  const toast = (kind: "ok" | "error", text: string) =>
    toasts.push([kind, text]);
  const marked: string[] = [];
  // Saved: the stop shown is the one marked.
  expect(
    await markShownReport(
      async (_, stop) => (marked.push(stop), true),
      leaf,
      "stop:shown",
      "builder",
      toast,
    ),
  ).toBe(true);
  // Refused (an unavailable store or a rejected Desk write), or thrown.
  expect(
    await markShownReport(
      async () => false,
      leaf,
      "stop:shown",
      "builder",
      toast,
    ),
  ).toBe(false);
  expect(
    await markShownReport(
      async () => {
        throw new Error("offline");
      },
      leaf,
      "stop:shown",
      "builder",
      toast,
    ),
  ).toBe(false);
  expect(marked).toEqual(["stop:shown"]);
  expect(toasts.map(([kind]) => kind)).toEqual(["ok", "error", "error"]);
  expect(toasts[1]![1]).toContain("Could not save the review mark for builder");
});
