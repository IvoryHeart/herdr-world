import { expect, test } from "bun:test";
import { validateLedger, validateTransition } from "./upstream-dispositions";

const base = "a".repeat(40);
const target = "b".repeat(40);
const old = "c".repeat(40);
const entry = (commit = target, status = "adopted") => ({
  commit,
  title: "Synthetic upstream change",
  status,
  reason: "Integrated with existing World ownership.",
  evidence: ["server/src/example.test.ts"],
  followUp:
    status === "deferred" ? "docs/upstream-follow-ups.md#example" : null,
  revisitWhen:
    status === "deferred"
      ? "Next source sync and before packaging migration."
      : null,
  reviewedFor: target,
});
const ledger = (source = target, changes = [entry()]) => ({
  schema: 1,
  source,
  changes,
});

test("every upstream commit requires exactly one disposition and evidence", () => {
  const before = validateLedger(ledger(base, []));
  expect(
    validateTransition(before, validateLedger(ledger()), base, target, [
      target,
    ]),
  ).toBe(false);
  expect(() =>
    validateTransition(
      before,
      validateLedger(ledger(target, [])),
      base,
      target,
      [target],
    ),
  ).toThrow();
  expect(() => validateLedger(ledger(target, [entry(), entry()]))).toThrow();
  expect(() =>
    validateLedger(ledger(target, [{ ...entry(), evidence: [] }])),
  ).toThrow();
  expect(() =>
    validateTransition(before, validateLedger(ledger()), base, target, [old]),
  ).toThrow();
});

test("new deferrals and divergences require human review and follow-up conditions", () => {
  const before = validateLedger(ledger(base, []));
  for (const status of ["deferred", "divergent"]) {
    const change = {
      ...entry(target, status),
      followUp: "docs/upstream-follow-ups.md#example",
      revisitWhen: "Every source sync.",
    };
    expect(
      validateTransition(
        before,
        validateLedger(ledger(target, [change])),
        base,
        target,
        [target],
      ),
    ).toBe(true);
    expect(() =>
      validateLedger(ledger(target, [{ ...change, followUp: null }])),
    ).toThrow();
  }
});

test("outstanding decisions cannot disappear, change silently, or skip reconsideration", () => {
  const previous = { ...entry(old, "deferred"), reviewedFor: base };
  const before = validateLedger(ledger(base, [previous]));
  const current = { ...previous, reviewedFor: target };
  expect(
    validateTransition(
      before,
      validateLedger(ledger(target, [current, entry()])),
      base,
      target,
      [target],
    ),
  ).toBe(false);
  expect(() =>
    validateTransition(before, validateLedger(ledger()), base, target, [
      target,
    ]),
  ).toThrow();
  expect(() =>
    validateTransition(
      before,
      validateLedger(ledger(target, [previous, entry()])),
      base,
      target,
      [target],
    ),
  ).toThrow();
  expect(
    validateTransition(
      before,
      validateLedger(
        ledger(target, [{ ...current, status: "adopted" }, entry()]),
      ),
      base,
      target,
      [target],
    ),
  ).toBe(true);
  expect(
    validateTransition(
      before,
      validateLedger(
        ledger(target, [{ ...current, reason: "Different policy." }, entry()]),
      ),
      base,
      target,
      [target],
    ),
  ).toBe(true);
  expect(() =>
    validateTransition(
      before,
      validateLedger(ledger(target, [current, entry()])),
      old,
      target,
      [target],
    ),
  ).toThrow();
});
