import { expect, test } from "bun:test";
import {
  concurrentWorkViolations,
  productionWorkCeilings,
  TOWN_IDLE_WORK_CEILINGS,
  TOWN_STATIC_WORK_CEILINGS,
  workViolations,
  type ConcurrentWork,
} from "./workCeilings";

const boardHosts = { "board.host-project": 64 };
const snapshot = {
  "world.prepare": 1,
  "world.build-units": 917_568,
  ...boardHosts,
};
// As measured at 1440 px on 2026-10-30.
const measured = (): ConcurrentWork => ({
  worldWorkByPhase: {
    projection: { ...boardHosts, "tree.project": 1, "board.project": 1 },
    render: { "board.project": 1 },
    refresh: { ...boardHosts, "board.project": 1 },
    "noisy-output": {},
  },
  terminalWorkByPhase: { "outside-stress": { open: 4, fit: 17, dispose: 4 } },
  boardObserverWorkByPhase: {
    render: { observe: 1280 },
    "outside-stress": { unobserve: 1280 },
  },
  boardRenderByPhase: { render: { commits: 6 }, refresh: { commits: 2 } },
  worldBuildUnits: 1_835_136,
  worldBuildMaxSliceNodes: 256,
  liveCardObservations: 0,
  repeatedCardRegistrations: 0,
});

test("the measured dense workload is within every ceiling", () => {
  expect(concurrentWorkViolations(measured(), 1440)).toEqual([]);
  const stage = { ...snapshot, "board.project": 1 };
  expect(
    workViolations(
      { initial: stage, refresh: stage },
      productionWorkCeilings("board"),
      "production",
    ),
  ).toEqual([]);
});

test("a render storm during terminal output fails", () => {
  const storm = measured();
  storm.boardRenderByPhase["noisy-output"] = { commits: 10_000 };
  storm.worldWorkByPhase["noisy-output"] = { "board.project": 10_000 };
  expect(concurrentWorkViolations(storm, 1440)).toEqual([
    "world work noisy-output: board.project 10000 > 0",
    "Board noisy-output: commits 10000 > 0",
  ]);
  const projectionCommits = measured();
  projectionCommits.boardRenderByPhase.projection = { commits: 1 };
  expect(concurrentWorkViolations(projectionCommits, 1440)).toEqual([
    "Board projection: commits 1 > 0",
  ]);
});

test("repeated preparation or projection fails, in either suite", () => {
  const repeated = measured();
  repeated.worldWorkByPhase.refresh!["board.project"] = 2;
  repeated.worldWorkByPhase.refresh!["board.host-project"] = 128;
  expect(concurrentWorkViolations(repeated, 1440)).toEqual([
    "world work refresh: board.host-project 128 > 64",
    "world work refresh: board.project 2 > 1",
  ]);
  // Production: a projection per keystroke, or one per terminal push.
  const typed = { ...snapshot, "office.project": 380 };
  expect(
    workViolations(
      { initial: typed, refresh: { ...snapshot, "office.project": 1 } },
      productionWorkCeilings("town"),
      "production",
    ),
  ).toEqual(["production initial: office.project 380 > 1"]);
});

test("cards must register once each and all be released, whichever way teardown releases them", () => {
  const disconnected = measured();
  // Board's disconnect released most cards before their own unobserve.
  disconnected.boardObserverWorkByPhase["outside-stress"] = { unobserve: 12 };
  expect(concurrentWorkViolations(disconnected, 1440)).toEqual([]);
  const perCard = measured();
  perCard.boardObserverWorkByPhase["outside-stress"] = { unobserve: 1280 };
  expect(concurrentWorkViolations(perCard, 1440)).toEqual([]);
  const leaked = measured();
  leaked.boardObserverWorkByPhase["outside-stress"] = {};
  leaked.liveCardObservations = 1280;
  expect(concurrentWorkViolations(leaked, 1440)).toEqual([
    "card observers: 1280 still observed after unmount",
  ]);
  const unrecorded = measured();
  unrecorded.liveCardObservations = -1;
  expect(concurrentWorkViolations(unrecorded, 1440)).toEqual([
    "card observers: live observations after unmount were not recorded",
  ]);
  // A browser whose layout leaves a few cards unmounted is fine...
  const fewer = measured();
  fewer.boardObserverWorkByPhase.render = { observe: 1248 };
  expect(concurrentWorkViolations(fewer, 1440)).toEqual([]);
  // ...registering a card twice, or none at all, is not, even while the
  // total stays under the theoretical ceiling.
  const twice = measured();
  twice.boardObserverWorkByPhase.render = { observe: 1253 };
  twice.repeatedCardRegistrations = 5;
  expect(concurrentWorkViolations(twice, 1440)).toEqual([
    "card observers: 5 cards registered again while still observed",
  ]);
  const phone = measured();
  phone.boardObserverWorkByPhase.render = { observe: 80 };
  phone.boardObserverWorkByPhase["outside-stress"] = { unobserve: 78 };
  phone.repeatedCardRegistrations = 2;
  expect(concurrentWorkViolations(phone, 390)).toEqual([
    "card observers: 2 cards registered again while still observed",
  ]);
  const overTotal = measured();
  overTotal.boardObserverWorkByPhase.render = { observe: 1281 };
  expect(concurrentWorkViolations(overTotal, 1440)).toEqual([
    "card observers render: observe 1281 > 1280",
  ]);
  const silent = measured();
  silent.boardObserverWorkByPhase.render = {};
  expect(concurrentWorkViolations(silent, 1440)).toEqual([
    "card observers: none registered while rendering",
  ]);
  const late = measured();
  late.boardObserverWorkByPhase.refresh = { observe: 1280 };
  expect(concurrentWorkViolations(late, 1440)).toEqual([
    "card observers refresh: observe 1280 > 0",
  ]);
});

test("a slower runner cuts more slices but does no more work, so it passes", () => {
  // Slices are not counted: a slice also ends after 8 ms. Units are counted.
  const slow = measured();
  expect(concurrentWorkViolations(slow, 1440)).toEqual([]);
  slow.worldBuildUnits += 1;
  expect(concurrentWorkViolations(slow, 1440)).toEqual([
    "world build units 1835137 > 1835136",
  ]);
});

test("idle Town commits only for its data polls, never per frame", () => {
  const idle = (frames: number) =>
    workViolations(
      { idle: { "commit-frames": frames } },
      TOWN_IDLE_WORK_CEILINGS,
      "Town",
    );
  expect(idle(2)).toEqual([]);
  // The frame-rate loop committed in every frame: 126 in 2 s.
  expect(idle(126)).toEqual(["Town idle: commit-frames 126 > 2"]);
});

test("a static Town has no per-second draw allowance", () => {
  expect(
    workViolations({ idle: { draws: 0 } }, TOWN_STATIC_WORK_CEILINGS, "Town"),
  ).toEqual([]);
  expect(
    workViolations({ idle: { draws: 64 } }, TOWN_STATIC_WORK_CEILINGS, "Town"),
  ).toEqual(["Town idle: draws 64 > 0"]);
});
