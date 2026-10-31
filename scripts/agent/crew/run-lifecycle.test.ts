import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "../crew-round-delivery-fixture";
import { NOW, SHA } from "../gate/cases";
import { SETTINGS_DEFAULTS } from "./plan";
import { settleRuns } from "./run-lifecycle";
import {
  actionsIn,
  activeRuns,
  addAction,
  addRun,
  getRun,
  setRunPid,
} from "./store";

afterEach(cleanupDeliveries);

test("an interrupted timeout cannot lose the run's owner notification", () => {
  const f = setup({ seedCycle: false });
  const id = addRun(
    f.crew,
    {
      actionKey: "manual:synthetic",
      reviewer: "rev2",
      pr: 7,
      head: SHA.reviewed,
      log: "stdout",
    },
    NOW,
  );
  setRunPid(f.crew, id, 1234);
  const expiry = NOW + 90 * 60_000;
  expect(() =>
    settleRuns(
      f.crew,
      SETTINGS_DEFAULTS,
      ".",
      expiry,
      f.deps,
      (action) => {
        addAction(f.crew, action, expiry);
        throw new Error("interrupted notification recording");
      },
      () => {},
    ),
  ).toThrow("interrupted notification recording");
  expect(activeRuns(f.crew)).toHaveLength(1);
  expect(actionsIn(f.crew, ["pending"])).toEqual([]);
  expect(f.killed).toEqual([]);

  const record = (action: Parameters<typeof addAction>[1]) => {
    addAction(f.crew, action, expiry);
  };
  settleRuns(f.crew, SETTINGS_DEFAULTS, ".", expiry, f.deps, record, () => {});
  settleRuns(
    f.crew,
    SETTINGS_DEFAULTS,
    ".",
    expiry + 60_000,
    f.deps,
    record,
    () => {},
  );
  expect(activeRuns(f.crew)).toEqual([]);
  expect(getRun(f.crew, id)?.exitCode).toBe(-124);
  expect(actionsIn(f.crew, ["pending"])).toHaveLength(1);
  expect(actionsIn(f.crew, ["pending"])[0]?.key).toBe(`run:${id}|timeout`);
  expect(f.killed).toEqual([1234]);
});
