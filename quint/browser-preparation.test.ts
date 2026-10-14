import { expect, test } from "bun:test";
import {
  replayBrowserPreparation,
  type PreparationState,
} from "./browser-preparation";
import { parseTrace } from "./traces";

const initial: PreparationState = {
  epoch: 0,
  captured: -1,
  stage: "idle",
  issued: 0,
  revision: 0,
  published: -1,
  status: "idle",
  queued: false,
  selected: -1,
  requested: -1,
  catalogue: false,
  live: [true, true],
  actionable: [false, false],
};
function trace(actions: [string, Partial<PreparationState>, number?][]) {
  let preparation = initial;
  const states = [{ op: "init", target: -1, preparation }];
  for (const [op, change, target = -1] of actions) {
    preparation = { ...preparation, ...change };
    states.push({ op, target, preparation });
  }
  return parseTrace("browser-preparation", JSON.stringify({ states }));
}
const boundaries: [string, Partial<PreparationState>][] = [
  ["request", { captured: 0, issued: 1, stage: "request", status: "loading" }],
  ["reply", { stage: "decode" }],
  ["project", { stage: "object" }],
  ["prepareOffice", { stage: "admission" }],
];
for (const stage of ["decode", "object", "admission"]) {
  const pause = boundaries.findIndex(([, change]) => change.stage === stage);
  test(`retirement during ${stage} preserves the healthy sibling's admission`, async () => {
    const states = trace([
      ...boundaries.slice(0, pause + 1),
      ["retire", { live: [false, true] }, 0],
      ...boundaries.slice(pause + 1),
      [
        "admit",
        {
          stage: "idle",
          published: 0,
          revision: 1,
          status: "ready",
          catalogue: true,
          actionable: [false, true],
        },
      ],
    ]);
    expect(
      (await replayBrowserPreparation(states)).has("siblingSurvives"),
    ).toBe(true);
  });
  test(`disconnect during ${stage} prevents obsolete publication`, async () => {
    const next = boundaries[pause + 1]?.[0] ?? "admit";
    const states = trace([
      ...boundaries.slice(0, pause + 1),
      ["disconnect", { epoch: 1, status: "error" }],
      [next, { stage: "idle" }],
    ]);
    expect(
      (await replayBrowserPreparation(states)).has(`${stage}Interrupted`),
    ).toBe(true);
  });
}
test("preparation trace rejects admission before projection", () => {
  expect(() => trace([["admit", {}]])).toThrow("precondition");
});

for (const stage of ["decode", "object", "admission"]) {
  const pause = boundaries.findIndex(([, change]) => change.stage === stage);
  test(`priority change during ${stage} admits current work and dispatches one follow-up with the new hint`, async () => {
    const states = trace([
      ...boundaries.slice(0, pause + 1),
      ["priority", { selected: 0, queued: true }, 0],
      ...boundaries.slice(pause + 1),
      [
        "admit",
        {
          stage: "request",
          issued: 2,
          queued: false,
          requested: 0,
          published: 0,
          revision: 1,
          status: "ready",
          catalogue: true,
          actionable: [true, true],
        },
      ],
      ["reply", { stage: "decode" }],
      ["project", { stage: "object" }],
      ["prepareOffice", { stage: "admission" }],
      ["admit", { stage: "idle", revision: 2 }],
    ]);
    expect(
      (await replayBrowserPreparation(states)).has("priorityFollowup"),
    ).toBe(true);
  });
}
