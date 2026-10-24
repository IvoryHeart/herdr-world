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

test("documentation and exact-head reuse allow only their expected skipped jobs", () => {
  expect(() =>
    assertDeliveryResults(
      "docs",
      "success",
      "success",
      "skipped",
      "success",
      skip,
    ),
  ).not.toThrow();
  expect(() =>
    assertDeliveryResults(
      "reuse",
      "success",
      "skipped",
      "skipped",
      "skipped",
      skip,
    ),
  ).not.toThrow();
  expect(() =>
    assertDeliveryResults(
      "docs",
      "success",
      "failure",
      "skipped",
      "success",
      skip,
    ),
  ).toThrow();
  expect(() =>
    assertDeliveryResults(
      "reuse",
      "failure",
      "skipped",
      "skipped",
      "skipped",
      skip,
    ),
  ).toThrow();
  expect(() =>
    assertDeliveryResults(
      undefined,
      "success",
      "skipped",
      "skipped",
      "success",
      skip,
    ),
  ).toThrow();
});

test("behavioral failure, cancellation and missing evidence block full and docs delivery", () => {
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
    expect(() =>
      assertDeliveryResults(
        "docs",
        "success",
        "success",
        "skipped",
        result,
        skip,
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
