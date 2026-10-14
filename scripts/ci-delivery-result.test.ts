import { expect, test } from "bun:test";
import { assertDeliveryResults } from "./ci-delivery-result";

test("full delivery requires both repository validation and every World shard to succeed", () => {
  expect(() =>
    assertDeliveryResults("full", "success", "success", "success", "success"),
  ).not.toThrow();
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    expect(() =>
      assertDeliveryResults("full", "success", "success", result, "success"),
    ).toThrow();
    expect(() =>
      assertDeliveryResults("full", "success", result, "success", "success"),
    ).toThrow();
    expect(() =>
      assertDeliveryResults("full", result, "success", "success", "success"),
    ).toThrow();
  }
});

test("documentation and exact-head reuse allow only their expected skipped jobs", () => {
  expect(() =>
    assertDeliveryResults("docs", "success", "success", "skipped", "success"),
  ).not.toThrow();
  expect(() =>
    assertDeliveryResults("reuse", "success", "skipped", "skipped", "skipped"),
  ).not.toThrow();
  expect(() =>
    assertDeliveryResults("docs", "success", "failure", "skipped", "success"),
  ).toThrow();
  expect(() =>
    assertDeliveryResults("reuse", "failure", "skipped", "skipped", "skipped"),
  ).toThrow();
  expect(() =>
    assertDeliveryResults(
      undefined,
      "success",
      "skipped",
      "skipped",
      "success",
    ),
  ).toThrow();
});

test("behavioral failure, cancellation and missing evidence block full and docs delivery", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    expect(() =>
      assertDeliveryResults("full", "success", "success", "success", result),
    ).toThrow();
    expect(() =>
      assertDeliveryResults("docs", "success", "success", "skipped", result),
    ).toThrow();
  }
});
