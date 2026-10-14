import { expect, test } from "bun:test";
import {
  replayCreationFlow,
  type CreationState,
  type CreationRequest,
} from "./creation-flow";
import { parseTrace } from "./traces";
const empty: CreationRequest = {
  phase: "idle",
  attempt: 0,
  retained: false,
  mutated: false,
  intent: -1,
  available: false,
  admission: "none",
  focus: 0,
  finished: true,
};
function build() {
  let creation: CreationState = {
    requests: [{ ...empty }, { ...empty }],
    live: [true, true],
    intent: 0,
  };
  const states = [{ ...creation, op: "init", target: -1 }];
  const event = (
    op: string,
    target: number,
    change: Partial<CreationRequest> = {},
    global: Partial<CreationState> = {},
  ) => {
    const requests = creation.requests.map((request) => ({ ...request }));
    if (target >= 0) requests[target] = { ...requests[target]!, ...change };
    creation = { ...creation, requests, ...global };
    states.push({ ...creation, op, target });
  };
  const start = (h: number) =>
    event("start", h, {
      phase: "preparing",
      retained: true,
      intent: creation.intent,
    });
  const begin = (h: number) =>
    event("beginAttach", h, { attempt: creation.requests[h]!.attempt + 1 });
  const attach = (h: number) =>
    event("attach", h, { phase: "dispatching", mutated: true });
  const result = (h: number) =>
    event("result", h, {
      phase: "created",
      retained: false,
      admission:
        creation.requests[h]!.intent === creation.intent
          ? "waiting"
          : "rejected",
    });
  const topology = (h: number) =>
    event("topology", h, {
      available: true,
      admission: "opening",
      finished: false,
    });
  const finish = (h: number) =>
    event("finishFocus", h, {
      finished: true,
      admission:
        creation.requests[h]!.admission === "opening" ? "opened" : "rejected",
      focus: creation.requests[h]!.admission === "opening" ? 1 : 0,
    });
  const intent = () =>
    event(
      "newIntent",
      -1,
      {},
      {
        intent: creation.intent + 1,
        requests: creation.requests.map((request) =>
          ["waiting", "opening"].includes(request.admission)
            ? { ...request, admission: "rejected" }
            : request,
        ),
      },
    );
  const retire = (h: number) =>
    event(
      "retire",
      h,
      {
        phase:
          creation.requests[h]!.phase === "preparing"
            ? "failed"
            : creation.requests[h]!.phase === "dispatching"
              ? "uncertain"
              : creation.requests[h]!.phase,
        retained: false,
        admission: ["waiting", "opening"].includes(
          creation.requests[h]!.admission,
        )
          ? "rejected"
          : creation.requests[h]!.admission,
      },
      { live: creation.live.map((value, i) => (i === h ? false : value)) },
    );
  return {
    event,
    start,
    begin,
    attach,
    result,
    topology,
    finish,
    intent,
    retire,
    trace: () => parseTrace("creation-flow", JSON.stringify({ states })),
  };
}
test("colliding source IDs on two owners stay distinct while duplicate creation coalesces", async () => {
  const b = build();
  b.start(0);
  b.start(1);
  b.event("duplicate", 0);
  b.begin(0);
  b.begin(0);
  b.event("oldAck", 0);
  b.begin(1);
  b.attach(0);
  b.attach(1);
  b.result(0);
  b.result(1);
  b.topology(0);
  b.finish(0);
  b.topology(1);
  b.finish(1);
  const witnesses = await replayCreationFlow(b.trace());
  for (const name of [
    "duplicateCoalesced",
    "lateAttachmentIgnored",
    "sourcePrepared",
    "conditionalFocus",
  ])
    expect(witnesses.has(name)).toBe(true);
});
for (const boundary of [
  "preparation",
  "readiness",
  "dispatch",
  "admission",
  "opening",
]) {
  test(`runtime retirement at ${boundary} rejects remaining authority without retry`, async () => {
    const b = build();
    b.start(0);
    b.begin(0);
    if (boundary === "readiness")
      b.event(
        "retireAtReady",
        0,
        { phase: "failed", retained: false },
        { live: [false, true] },
      );
    else {
      if (boundary !== "preparation") b.attach(0);
      if (["admission", "opening"].includes(boundary)) b.result(0);
      if (boundary === "opening") b.topology(0);
      b.retire(0);
      if (boundary === "dispatch") b.event("lateResult", 0);
      if (boundary === "opening") b.finish(0);
    }
    const witnesses = await replayCreationFlow(b.trace());
    if (boundary === "readiness")
      expect(witnesses.has("readinessRetired")).toBe(true);
    if (boundary === "dispatch")
      expect(witnesses.has("uncertainDispatch")).toBe(true);
  });
}
for (const boundary of ["dispatch", "opening"]) {
  test(`newer Inspector intent at ${boundary} suppresses older automatic focus`, async () => {
    const b = build();
    b.start(0);
    b.begin(0);
    b.attach(0);
    if (boundary === "opening") {
      b.result(0);
      b.topology(0);
    }
    b.intent();
    if (boundary === "dispatch") b.result(0);
    else b.finish(0);
    expect((await replayCreationFlow(b.trace())).has("newerIntent")).toBe(true);
  });
}
