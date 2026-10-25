import { describe, expect, test } from "bun:test";
import { TerminalRecoveryBudget } from "./terminalRecovery";

describe("local terminal recovery", () => {
  test("two retries then an unavailable display, with no navigation callback", () => {
    const recovery = new TerminalRecoveryBudget();
    expect(recovery.fail()).toBe("retry");
    expect(recovery.fail()).toBe("retry");
    expect(recovery.fail()).toBe("unavailable");
    expect(recovery.fail()).toBe("unavailable");
  });

  test("fresh output or an explicit terminal retry resets the attach budget", () => {
    const recovery = new TerminalRecoveryBudget();
    for (let attempt = 0; attempt < 3; attempt++) recovery.fail();
    recovery.reset();
    expect(recovery.fail()).toBe("retry");
    recovery.reset();
    expect(recovery.fail()).toBe("retry");
    expect(recovery.fail()).toBe("retry");
    expect(recovery.fail()).toBe("unavailable");
  });
});
