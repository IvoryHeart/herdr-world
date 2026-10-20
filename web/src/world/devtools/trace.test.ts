import { describe, expect, test } from "bun:test";
import { DEVTOOLS, NO_TRACE } from "./flag";
import { createTrace, DEVTOOLS_MARKER, traceRequested } from "./trace";

describe("View event trace (development builds)", () => {
  test("records only when enabled, keeps the newest entries, and exports them", () => {
    let t = 0;
    const trace = createTrace("board", 3, () => (t += 5));
    trace.record("ignored");
    expect(trace.entries()).toEqual([]);
    trace.enabled = true;
    for (const kind of ["a", "b", "c", "d"]) trace.record(kind, { n: kind });
    expect(trace.entries().map((e) => e.kind)).toEqual(["b", "c", "d"]);
    expect(JSON.parse(trace.export({ width: 390 }))).toMatchObject({
      version: 1,
      tool: DEVTOOLS_MARKER,
      view: "board",
      context: { width: 390 },
    });
  });

  test("each view's trace starts from its own URL switch or saved choice", () => {
    expect(traceRequested("board", "?debug=board", null)).toBe(true);
    expect(traceRequested("town", "?debug=town", null)).toBe(true);
    expect(traceRequested("board", "", "on")).toBe(true);
    expect(traceRequested("board", "?debug=town", "off")).toBe(false);
  });

  test("tests and fixtures, which do not define the build flag, keep the tools", () => {
    expect(DEVTOOLS).toBe(true);
    NO_TRACE.record("anything");
    expect(NO_TRACE.entries()).toEqual([]);
    expect(NO_TRACE.enabled).toBe(false);
  });
});
