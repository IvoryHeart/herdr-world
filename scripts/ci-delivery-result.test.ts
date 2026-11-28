import { expect, test } from "bun:test";
import {
  assertDeliveryResults,
  type DeliveryResults,
} from "./ci-delivery-result";
import type { ValidationSelection } from "./validation-scope";

const selection = (
  world: boolean,
  web: boolean,
  verification: boolean,
  packaging = false,
): ValidationSelection => ({
  full: false,
  tooling: false,
  documentation: false,
  reason: "fixture",
  unit: [],
  world: world ? ["fixture"] : [],
  worldShards: [],
  web: web ? ["fixture"] : [],
  packaging,
  verification,
});

test("delivery requires every leaf: failure, cancellation, skipped and missing evidence block", () => {
  for (const mode of ["full", "scoped", "tooling", "docs", "reuse"]) {
    for (const packaging of [false, true]) {
      if (!["full", "scoped"].includes(mode) && packaging) continue;
      for (const event of [
        "pull_request",
        "push",
        "merge_group",
        "workflow_dispatch",
      ]) {
        for (const world of mode === "scoped"
          ? [false, true]
          : [mode === "full"])
          for (const web of mode === "scoped"
            ? [false, true]
            : [mode === "full"])
            for (const verification of mode === "scoped"
              ? [false, true]
              : [mode === "full"]) {
              const plan = selection(world, web, verification, packaging);
              const expected: DeliveryResults = {
                scope: "success",
                description: event === "pull_request" ? "success" : "skipped",
                security: mode === "reuse" ? "skipped" : "success",
                static: mode === "reuse" ? "skipped" : "success",
                unit: ["docs", "reuse"].includes(mode) ? "skipped" : "success",
                combined: ["docs", "reuse"].includes(mode)
                  ? "skipped"
                  : "success",
                world: world ? "success" : "skipped",
                web: web ? "success" : "skipped",
                behavioral: verification ? "success" : "skipped",
              };
              const check = (results: DeliveryResults) =>
                assertDeliveryResults(mode, results, plan, event);
              expect(check(expected)).toBeUndefined();
              for (const key of Object.keys(expected) as Array<
                keyof DeliveryResults
              >)
                for (const result of [
                  "failure",
                  "cancelled",
                  undefined,
                  expected[key] === "success" ? "skipped" : "success",
                ]) {
                  expect(() => check({ ...expected, [key]: result })).toThrow();
                }
            }
      }
    }
  }
});

test("unknown modes, held results and missing scoped plans cannot pass", () => {
  const results: DeliveryResults = {
    scope: "success",
    description: "success",
    security: "success",
    static: "success",
    unit: "success",
    combined: "success",
    world: "skipped",
    web: "skipped",
    behavioral: "skipped",
  };
  for (const mode of [undefined, "unknown", "hold", "scoped"])
    expect(() => assertDeliveryResults(mode, results)).toThrow();
});
