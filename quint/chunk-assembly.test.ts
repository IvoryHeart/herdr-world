import { expect, test } from "bun:test";
import { Bridge } from "../web/src/api";
import {
  replayChunkAssembly,
  type AssemblyState,
  type AssemblyCell,
} from "./chunk-assembly";
import { ObservationMismatch } from "./observations";
import { parseTrace } from "./traces";
const empty: AssemblyCell = {
  phase: "empty",
  next: 0,
  ordinal: 0,
  epoch: 0,
  decoded: false,
  finished: true,
  aborted: false,
};
function build() {
  let state: AssemblyState = {
    cells: [{ ...empty }, { ...empty }],
    epoch: 0,
    connected: true,
    calls: 0,
    acceptedOld: false,
  };
  const states = [{ ...state, op: "init", target: -1 }];
  const event = (
    op: string,
    target: number,
    change: Partial<AssemblyCell> = {},
    global: Partial<AssemblyState> = {},
  ) => {
    const cells = state.cells.map((cell) => ({ ...cell }));
    if (target >= 0) cells[target] = { ...cells[target]!, ...change };
    state = { ...state, cells, acceptedOld: false, ...global };
    states.push({ ...state, op, target });
  };
  const call = (h: number) =>
    event(
      "call",
      h,
      {
        ...empty,
        phase: "collecting",
        ordinal: state.calls + 1,
        epoch: state.epoch,
      },
      { calls: state.calls + 1 },
    );
  const fragment = (h: number) => {
    const next = state.cells[h]!.next + 1;
    event("fragment", h, {
      next,
      phase: next === 3 ? "decoding" : "collecting",
      decoded: next === 3,
      finished: next !== 3,
    });
  };
  const disconnect = () =>
    event(
      "disconnect",
      -1,
      {},
      {
        epoch: state.epoch + 1,
        connected: false,
        cells: state.cells.map((cell) =>
          ["collecting", "decoding"].includes(cell.phase)
            ? { ...cell, phase: "failed", aborted: cell.decoded }
            : cell,
        ),
      },
    );
  return {
    event,
    call,
    fragment,
    disconnect,
    trace: () => parseTrace("chunk-assembly", JSON.stringify({ states })),
  };
}
test("interleaved replies assemble only their own request and decode before resolving", async () => {
  const b = build();
  b.call(0);
  b.call(1);
  b.fragment(0);
  b.fragment(1);
  b.fragment(0);
  b.fragment(1);
  b.fragment(0);
  b.event("finishDecode", 0, { phase: "done", finished: true });
  b.fragment(1);
  b.event("finishDecode", 1, { phase: "done", finished: true });
  const witnesses = await replayChunkAssembly(b.trace());
  expect(witnesses.has("completed")).toBe(true);
  expect(witnesses.has("parallelCalls")).toBe(true);
});
test("retired decode cannot resolve after reconnect and old-socket bytes cannot finish a new request", async () => {
  const b = build();
  b.call(0);
  b.fragment(0);
  b.fragment(0);
  b.fragment(0);
  b.disconnect();
  b.event("reconnect", -1, {}, { connected: true });
  b.event("finishDecode", 0, { finished: true });
  b.call(0);
  b.fragment(0);
  b.fragment(0);
  b.event("oldSocket", 0);
  b.fragment(0);
  b.event("finishDecode", 0, { phase: "done", finished: true });
  const witnesses = await replayChunkAssembly(b.trace());
  for (const name of ["cancelledDecode", "oldSocketIgnored", "completed"])
    expect(witnesses.has(name)).toBe(true);
});
for (const op of ["duplicate", "outOfOrder", "wrongTotal", "qualifiedChunk"]) {
  test(`assembly rejects ${op} without publishing partial data`, async () => {
    const b = build();
    b.call(0);
    if (["duplicate", "wrongTotal"].includes(op)) b.fragment(0);
    b.event(op, 0, { phase: "failed" });
    expect(
      (await replayChunkAssembly(b.trace())).has("malformedRejected"),
    ).toBe(true);
  });
}
test("extra chunks retire an in-flight decoder rather than admitting its result", async () => {
  const b = build();
  b.call(0);
  b.fragment(0);
  b.fragment(0);
  b.fragment(0);
  b.event("duplicate", 0, { phase: "failed", aborted: true });
  b.event("finishDecode", 0, { finished: true });
  expect((await replayChunkAssembly(b.trace())).has("cancelledDecode")).toBe(
    true,
  );
});
test("assembly trace action preconditions fail before conformance replay", () => {
  const b = build();
  b.event("finishDecode", 0);
  expect(() => b.trace()).toThrow("precondition");
});
test("cleanup error overrides an expected model mismatch and restores fixture globals", async () => {
  const original = globalThis.WebSocket;
  class CleanupFails extends Bridge {
    private retirements = 0;
    override disconnect(reason?: string) {
      super.disconnect(reason);
      if (
        reason === "Synthetic assembly retirement" &&
        ++this.retirements === 2
      )
        throw new Error("Synthetic cleanup failure");
    }
  }
  const b = build();
  b.call(0);
  b.disconnect();
  b.event("reconnect", -1, {}, { connected: true });
  b.call(0);
  b.fragment(0);
  b.fragment(0);
  b.event(
    "oldSocket",
    0,
    { phase: "decoding", next: 3, decoded: true, finished: false },
    { acceptedOld: true },
  );
  let failure: unknown;
  try {
    await replayChunkAssembly(b.trace(), CleanupFails);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(ObservationMismatch);
  expect((failure as Error).message).toBe("Synthetic cleanup failure");
  expect(globalThis.WebSocket).toBe(original);
});
