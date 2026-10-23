import { describe, expect, test } from "bun:test";
import { interestKey } from "../../../shared/interest";
import { agentInterest, keepInterests } from "./useAgentInterest";

describe("agent interest for chimes", () => {
  test("an agent without a record is watching; focus is seen anywhere", () => {
    const none = agentInterest({});
    expect(none.interestOf("conn-a", "term_1")).toBe("watching");
    expect(none.anyFocused).toBe(false);
    const some = agentInterest({
      [interestKey("conn-a", "term_1")]: "muted",
      [interestKey("conn-b", "term_1")]: "focused",
    });
    expect(some.interestOf("conn-a", "term_1")).toBe("muted");
    expect(some.interestOf("conn-b", "term_1")).toBe("focused");
    expect(some.interestOf("conn-a", "term_2")).toBe("watching");
    expect(some.anyFocused).toBe(true);
  });

  test("records keep their identity until one changes", () => {
    const last = { a: "muted" as const };
    expect(keepInterests(last, { a: "muted" })).toBe(last);
    const next = { a: "focused" as const };
    expect(keepInterests(last, next)).toBe(next);
  });
});
