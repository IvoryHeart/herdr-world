import assert from "node:assert/strict";
import type { TraceState } from "./replay";
export function validateObservationTrace(
  value: unknown,
): asserts value is TraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty base trace");
  const actions = [
    "init",
    "request",
    "reply",
    "apply",
    "change",
    "retire",
    "browserRetire",
    "drop",
    "restart",
    "disconnect",
  ];
  for (const [i, entry] of value.entries()) {
    assert(
      entry &&
        actions.includes(entry.op) &&
        (i === 0 ? entry.op === "init" : entry.op !== "init"),
    );
    const s = entry.s;
    assert(s && typeof s === "object");
    for (const [name, min, max] of [
      ["inc", 0, 1],
      ["epoch", 0, 2],
      ["heldInc", -1, 1],
      ["baseInc", -1, 1],
      ["replyInc", -1, 1],
      ["issued", 0, 6],
      ["captured", -1, 2],
    ] as const)
      assert(
        Number.isInteger(s[name]) && s[name] >= min && s[name] <= max,
        `invalid base ${name}`,
      );
    assert(["idle", "requested", "replied"].includes(s.phase));
    for (const [name, min, max] of [
      ["gen", 1, 2],
      ["token", 0, 2],
      ["heldGen", -1, 2],
      ["baseGen", -1, 2],
      ["replyGen", -1, 2],
      ["heldToken", -1, 2],
      ["baseToken", -1, 2],
      ["replyToken", -1, 2],
      ["contentInc", -1, 1],
    ] as const)
      assert(
        Array.isArray(s[name]) &&
          s[name].length === 2 &&
          s[name].every(
            (v: unknown) =>
              Number.isInteger(v) &&
              (v as number) >= min &&
              (v as number) <= max &&
              (!name.endsWith("Gen") || v !== 0),
          ),
      );
    for (const name of ["live", "actionable", "confirms"])
      assert(
        Array.isArray(s[name]) &&
          s[name].length === 2 &&
          s[name].every((v: unknown) => typeof v === "boolean"),
      );
    assert(
      typeof s.fresh === "boolean" && typeof s.validConfirmation === "boolean",
    );
    assert(
      [
        "none",
        "ignored",
        "discarded",
        "restarted",
        "retired",
        "replaced",
        "unchanged",
        "complete",
      ].includes(entry.outcome),
    );
    assert(Number.isInteger(entry.host) && entry.host >= -1 && entry.host <= 1);
  }
}
