import { expect, test } from "bun:test";
import { replayWritePath, writePathScenarios } from "./world-write-path";

for (const scenario of writePathScenarios)
  test(`world write path: ${scenario} replays through the real fence, commands and replica`, async () => {
    const result = await replayWritePath(scenario);
    expect(result.shows[0]).toBe(result.shows[1]);
  });
