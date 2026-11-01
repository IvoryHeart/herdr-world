import { expect, test } from "bun:test";
import { summarize } from "./report";

test("performance report keeps diagnostic and warmup timings out of measured cells", () => {
  const row = (kind: string, warmup: boolean, elapsedMs: number) => ({
    kind,
    warmup,
    shape: { id: "synthetic" },
    browser: {
      view: "town",
      device: { id: "phone" },
      rendered: {},
      phases: [
        {
          name: "idle",
          elapsedMs,
          rendererTaskMs: 1,
          work: { commits: 2, raf: 3 },
          frameIntervalsMs: { p95: null },
          heap: { usedSize: 100 },
          errors: [],
        },
      ],
    },
  });
  const summary = summarize([
    row("browser", true, 999),
    row("browser", false, 10),
    row("diagnostic", false, 888),
  ]);
  expect(summary.browsers).toHaveLength(1);
  expect(summary.browsers[0]!.elapsedMs).toMatchObject({
    n: 1,
    median: 10,
    max: 10,
  });
  expect(summary.diagnostics).toHaveLength(1);
  expect(summary.browsers[0]!.p95FrameIntervalMs.n).toBe(0);
});

test("report retains native refusal and excludes Board process warmups", () => {
  const summary = summarize([
    { kind: "native-boundary", limitBytes: 1048576 },
    { kind: "board-size", warmup: true, noteCount: 500 },
    { kind: "board-size", warmup: false, noteCount: 100 },
  ]);
  expect(summary.nativeBoundaries).toHaveLength(1);
  expect(summary.boardSizes.map((r) => r.noteCount)).toEqual([100]);
});
