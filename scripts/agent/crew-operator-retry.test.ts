import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupDeliveries,
  cleanups,
  setup,
} from "./crew-round-delivery-fixture";
import { NOW, SHA } from "./gate/cases";
import { SETTINGS_DEFAULTS } from "./crew/plan";
import { authorizedTimeoutRetry } from "./crew/operator-retry";
import { settleRuns } from "./crew/run-lifecycle";
import { startReviewers } from "./crew/reviewer-delivery";
import {
  addAction,
  addRun,
  finishRun,
  getAction,
  getMeta,
  getRun,
  setAction,
  setMeta,
  setRunSession,
  roundFor,
  actionsIn,
} from "./crew/store";
afterEach(cleanupDeliveries);
function fixture() {
  const f = setup();
  const action = {
    key: "7:fixed:confirm:rev2:round-2",
    pr: 7,
    head: SHA.fixed,
    kind: "confirm" as const,
    target: "rev2",
    text: "scoped confirmation",
    since: SHA.reviewed,
  };
  addAction(f.crew, action, NOW);
  const round = roundFor(f.crew, 7, SHA.fixed, NOW);
  const id = addRun(
    f.crew,
    {
      actionKey: action.key,
      reviewer: "rev2",
      pr: 7,
      head: SHA.fixed,
      round: round.round,
      log: "stdout",
    },
    NOW,
  );
  setRunSession(f.crew, id, "codex", "gpt-6.1-sol", "original-session");
  finishRun(f.crew, id, -124, null, NOW + 1);
  setAction(f.crew, action.key, "pending", NOW + 1, "operator retry", true);
  const grant = {
    authorizedBy: "steward-main",
    authorizedAt: NOW + 1,
    priorRun: id,
    actionKey: action.key,
    pr: 7,
    head: SHA.fixed,
    reviewer: "rev2",
    session: "original-session",
    round: round.round,
    maxRetries: 1,
    retryRun: null,
  };
  const settle = () =>
    settleRuns(
      f.crew,
      SETTINGS_DEFAULTS,
      "/synthetic/crew",
      NOW + 2,
      f.deps,
      () => {},
      () => {},
    );
  return { ...f, action, id, grant, settle };
}
test("rearming a timed-out action without explicit authorization remains held", () => {
  const f = fixture();
  f.settle();
  expect(getAction(f.crew, f.action.key)?.state).toBe("failed");
  expect(getRun(f.crew, f.id)?.exitCode).toBe(-124);
});
test.each([
  "head",
  "session",
  "round",
  "priorRun",
  "actionKey",
  "maxRetries",
  "retryRun",
])("retry grant cannot cross its pinned %s", (field) => {
  const f = fixture();
  setMeta(
    f.crew,
    "operator-retry:" + f.id,
    JSON.stringify({ ...f.grant, [field]: "different" }),
  );
  expect(
    authorizedTimeoutRetry(
      f.crew,
      getAction(f.crew, f.action.key)!,
      getRun(f.crew, f.id),
    ),
  ).toBeNull();
  f.settle();
  expect(getAction(f.crew, f.action.key)?.state).toBe("failed");
});
test("one explicit retry survives settlement, consumes its grant on normal launch, and retains the original timeout", () => {
  const f = fixture();
  const dir = mkdtempSync(join(tmpdir(), "crew-operator-retry-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  setMeta(f.crew, "operator-retry:" + f.id, JSON.stringify(f.grant));
  const before = getRun(f.crew, f.id);
  f.settle();
  expect(getAction(f.crew, f.action.key)?.state).toBe("pending");
  startReviewers(
    f.crew,
    { now: NOW + 3, dir, deps: f.deps, worker: ["bun", "crew.ts"] },
    { ...SETTINGS_DEFAULTS, maxRuns: 1 },
    actionsIn(f.crew, ["pending"]),
    new Map(),
    () => {},
    () => {},
  );
  const auth = JSON.parse(getMeta(f.crew, "operator-retry:" + f.id)!);
  expect(auth.retryRun).toBe(f.id + 1);
  expect(getRun(f.crew, auth.retryRun)).toMatchObject({
    actionKey: f.action.key,
    pr: 7,
    head: SHA.fixed,
    round: 2,
  });
  expect(getAction(f.crew, f.action.key)?.attempts).toBe(2);
  expect(getRun(f.crew, f.id)).toEqual(before);
  finishRun(f.crew, auth.retryRun, 1, null, NOW + 4);
  f.settle();
  expect(getAction(f.crew, f.action.key)?.state).toBe("failed");
  expect(f.spawned).toHaveLength(1);
});
