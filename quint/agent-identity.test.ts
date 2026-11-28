import { expect, test } from "bun:test";
import { identityScenarios, replayAgentIdentity } from "./agent-identity";

for (const scenario of identityScenarios)
  test(`agent identity: ${scenario} replays through the real store and resolver`, async () => {
    const result = await replayAgentIdentity(scenario);
    expect(result.states.length).toBeGreaterThan(0);
  });
