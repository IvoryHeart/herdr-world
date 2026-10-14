import { expect, test } from "bun:test";
import { parseCgroupResources } from "./verification-resources";

test("resource evidence requires actual aggregate peak, enforced limit and OOM accounting", () => {
  expect(
    parseCgroupResources(
      "123456\n",
      "low 0\nmax 3\noom 1\noom_kill 1\n",
      "67108864\n",
    ),
  ).toEqual({
    peakBytes: 123456,
    memoryMaxBytes: 67108864,
    oomKills: 1,
  });
  expect(() => parseCgroupResources("0", "oom_kill 0", "67108864")).toThrow(
    "peak",
  );
  expect(() => parseCgroupResources("123", "oom_kill 0", "max")).toThrow(
    "limit",
  );
  expect(() => parseCgroupResources("123", "oom 0", "67108864")).toThrow("OOM");
});
