import { expect, test } from "bun:test";
import { instrumentAssertions } from "./assertionPhases";

test("assertion timing evaluates every condition once, retains failure and propagates exceptions", () => {
  const owner = globalThis as unknown as {
    __herdrTestAssert?: (work: () => unknown) => unknown;
  };
  const previous = owner.__herdrTestAssert;
  let measured = 0,
    evaluated = 0;
  owner.__herdrTestAssert = (work) => {
    measured++;
    return work();
  };
  const observed: unknown[] = [];
  const check = (value: unknown, message: string) => {
    observed.push([value, message]);
  };
  try {
    new Function(
      "check",
      "next",
      instrumentAssertions(
        'check(next(), "kept"); check(false, "failure");',
        "fixture.browser.ts",
      ),
    )(check, () => {
      evaluated++;
      return true;
    });
    expect(observed).toEqual([
      [true, "kept"],
      [false, "failure"],
    ]);
    expect(evaluated).toBe(1);
    expect(measured).toBe(2);
    expect(() =>
      new Function(
        "check",
        instrumentAssertions(
          'check((() => { throw Error("original"); })(), "throw");',
          "fixture.browser.ts",
        ),
      )(check),
    ).toThrow("original");
    delete owner.__herdrTestAssert;
    new Function(
      "check",
      instrumentAssertions('check(true, "standalone");', "fixture.browser.ts"),
    )(check);
    expect(observed[observed.length - 1]).toEqual([true, "standalone"]);
  } finally {
    if (previous) owner.__herdrTestAssert = previous;
    else delete owner.__herdrTestAssert;
  }
});
