import { expect, test } from "bun:test";
import { assertDeliveryResults } from "./ci-delivery-result";

const ok = ["success", "success", "success"];
const skip = ["skipped", "skipped", "success"];

test("full delivery requires both repository validation and every World shard to succeed", () => {
  expect(() =>
    assertDeliveryResults(
      "full",
      "success",
      "success",
      "success",
      "success",
      ok,
    ),
  ).not.toThrow();
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    expect(() =>
      assertDeliveryResults(
        "full",
        "success",
        "success",
        result,
        "success",
        ok,
      ),
    ).toThrow();
    expect(() =>
      assertDeliveryResults(
        "full",
        "success",
        result,
        "success",
        "success",
        ok,
      ),
    ).toThrow();
    expect(() =>
      assertDeliveryResults(
        "full",
        result,
        "success",
        "success",
        "success",
        ok,
      ),
    ).toThrow();
  }
});

test("docs and reuse require their exact skipped results", () => {
  for (const mode of ["docs", "reuse"]) {
    const validation = mode === "docs" ? "success" : "skipped";
    expect(() =>
      assertDeliveryResults(
        mode,
        "success",
        validation,
        "skipped",
        "skipped",
        skip,
      ),
    ).not.toThrow();
    for (const result of ["success", "failure", "cancelled", undefined]) {
      expect(() =>
        assertDeliveryResults(
          mode,
          "success",
          validation,
          "skipped",
          result,
          skip,
        ),
      ).toThrow();
    }
  }
  expect(() =>
    assertDeliveryResults(
      undefined,
      "success",
      "skipped",
      "skipped",
      "skipped",
      skip,
    ),
  ).toThrow();
});

test("behavioral failure, cancellation and missing evidence block full delivery", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    expect(() =>
      assertDeliveryResults(
        "full",
        "success",
        "success",
        "success",
        result,
        ok,
      ),
    ).toThrow();
  }
});

test("every native result is required, including macOS jobs that skip native steps", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    for (const index of [0, 1, 2]) {
      const packaging: Array<string | undefined> = [...ok];
      packaging[index] = result;
      expect(() =>
        assertDeliveryResults(
          "full",
          "success",
          "success",
          "success",
          "success",
          packaging,
        ),
      ).toThrow();
    }
  }
  expect(() =>
    assertDeliveryResults("full", "success", "success", "success", "success", [
      "success",
    ]),
  ).toThrow();
  for (const result of [
    "success",
    "failure",
    "cancelled",
    "skipped",
    undefined,
  ]) {
    for (const index of [0, 1, 2]) {
      if (result === skip[index]) continue;
      const packaging: Array<string | undefined> = [...skip];
      packaging[index] = result;
      expect(() =>
        assertDeliveryResults(
          "docs",
          "success",
          "success",
          "skipped",
          "success",
          packaging,
        ),
      ).toThrow();
      expect(() =>
        assertDeliveryResults(
          "reuse",
          "success",
          "skipped",
          "skipped",
          "skipped",
          packaging,
        ),
      ).toThrow();
    }
  }
});

test("tooling delivery requires validation and protected macOS reports, with heavy jobs skipped", () => {
  const results = [
    "success",
    "success",
    "skipped",
    "skipped",
    "skipped",
    "skipped",
    "success",
  ];
  const check = (r: Array<string | undefined>) =>
    assertDeliveryResults("tooling", r[0], r[1], r[2], r[3], r.slice(4));
  expect(() => check(results)).not.toThrow();
  for (let index = 0; index < results.length; index++) {
    for (const result of [
      "failure",
      "cancelled",
      undefined,
      results[index] === "success" ? "skipped" : "success",
    ]) {
      const changed = [...results] as Array<string | undefined>;
      changed[index] = result;
      expect(() => check(changed)).toThrow();
    }
  }
});

test("scoped delivery accepts only its planned jobs and rejects every absent or failed dependency", () => {
  for (const verification of [false, true])
    for (const packaging of [false, true])
      for (const browser of [false, true]) {
        const selection = {
          full: false,
          tooling: false,
          documentation: false,
          reason: "fixture",
          unit: [],
          world: browser ? ["web/src/world/fixture.test.ts"] : [],
          worldShards: [],
          web: [],
          latency: [],
          verification,
          packaging,
        };
        const results = [
          "success",
          "success",
          browser ? "success" : "skipped",
          verification ? "success" : "skipped",
          packaging ? "success" : "skipped",
          packaging ? "success" : "skipped",
          "success",
        ];
        const check = (r: Array<string | undefined>) =>
          assertDeliveryResults(
            "scoped",
            r[0],
            r[1],
            r[2],
            r[3],
            r.slice(4),
            selection,
          );
        expect(() => check(results)).not.toThrow();
        for (let index = 0; index < results.length; index++)
          for (const result of [
            "failure",
            "cancelled",
            undefined,
            results[index] === "success" ? "skipped" : "success",
          ]) {
            const changed: Array<string | undefined> = [...results];
            changed[index] = result;
            expect(() => check(changed)).toThrow();
          }
      }
  expect(() =>
    assertDeliveryResults(
      "scoped",
      "success",
      "success",
      "skipped",
      "skipped",
      skip,
    ),
  ).toThrow();
});
