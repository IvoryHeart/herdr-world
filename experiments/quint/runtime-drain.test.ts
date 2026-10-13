import { expect, test } from "bun:test";
import { replayRuntimeDrain, type DrainState } from "./runtime-drain";
import { parseTrace } from "./traces";

test("every bounded retirement/start/cleanup combination drains its captured lifecycle", async () => {
  let cases = 0;
  const witnesses = new Set<string>();
  for (const kind of [0, 1, 2, 3, 4, 5])
    for (const failed of [false, true])
      for (const cleanupFirst of [false, true]) {
        if (kind === 5 && cleanupFirst) continue;
        let drain: DrainState = {
          kind: -1,
          failed: false,
          cleanupFirst: false,
          phase: "absent",
          gen: 0,
          transportDone: false,
          cleanupDone: false,
          readySeen: false,
          stage: "empty",
        };
        const states = [{ op: "init", drain }];
        const append = (op: string, change: Partial<DrainState>) => {
          drain = { ...drain, ...change };
          states.push({ op, drain });
        };
        append("choose", {
          kind,
          failed,
          cleanupFirst,
          phase: "connecting",
          gen: 1,
          stage: "starting",
        });
        append("retire", {
          phase: kind >= 4 ? "error" : "stopping",
          gen: kind === 1 ? 3 : 2,
          transportDone: kind === 5,
          stage: "draining",
        });
        if (kind !== 5)
          append("finishFirst", {
            cleanupDone: cleanupFirst,
            transportDone: !cleanupFirst,
            stage: "half",
          });
        const phase =
          kind === 2
            ? "removed"
            : kind >= 4 || failed
              ? "error"
              : "disconnected";
        append("finishSecond", {
          cleanupDone: true,
          transportDone: true,
          stage: "done",
          phase,
        });
        const observed = await replayRuntimeDrain(
          parseTrace("runtime-drain", JSON.stringify({ states })),
        );
        for (const witness of observed) witnesses.add(witness);
        cases++;
      }
  expect(cases).toBe(22);
  for (const name of [
    "stoppedDuringStart",
    "replacedDuringStart",
    "removedDuringStart",
    "shutdownDuringStart",
    "currentErrorDuringStart",
    "failedStart",
    "cleanupBeforeTransport",
    "transportBeforeCleanup",
    "failedDrain",
  ])
    expect(witnesses.has(name)).toBe(true);
});
