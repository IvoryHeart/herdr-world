import { expect, test } from "bun:test";
import { assertDeliveryResults } from "./ci-delivery-result";
import type { ValidationSelection } from "./validation-scope";

const selection = (
  packaging: boolean,
  browser = false,
  verification = false,
): ValidationSelection => ({
  full: false,
  tooling: false,
  documentation: false,
  reason: "fixture",
  unit: [],
  world: browser ? ["fixture"] : [],
  worldShards: [],
  web: [],
  packaging,
  verification,
});

test("aggregate accepts exactly the selected lanes; failure, cancellation and missing results block", () => {
  for (const mode of ["full", "scoped", "tooling", "docs", "reuse"]) {
    for (const native of [false, true]) {
      if (!["full", "scoped"].includes(mode) && native) continue;
      for (const browser of mode === "scoped"
        ? [false, true]
        : [mode === "full"])
        for (const verification of mode === "scoped"
          ? [false, true]
          : [mode === "full"]) {
          const plan = selection(native, browser, verification);
          const expected = [
            "success",
            mode === "reuse" ? "skipped" : "success",
            browser ? "success" : "skipped",
            verification ? "success" : "skipped",
          ];
          const check = (rows: Array<string | undefined>) =>
            assertDeliveryResults(
              mode,
              rows[0],
              rows[1],
              rows[2],
              rows[3],
              plan,
            );
          expect(check(expected)).toBeUndefined();
          for (let index = 0; index < expected.length; index++)
            for (const result of [
              "failure",
              "cancelled",
              undefined,
              expected[index] === "success" ? "skipped" : "success",
            ]) {
              const rows: Array<string | undefined> = [...expected];
              rows[index] = result;
              expect(() => check(rows)).toThrow();
            }
        }
    }
  }
});

test("unknown modes and missing scoped plans cannot pass", () => {
  for (const mode of [undefined, "unknown", "hold", "scoped"])
    expect(() =>
      assertDeliveryResults(mode, "success", "success", "skipped", "skipped"),
    ).toThrow();
});
