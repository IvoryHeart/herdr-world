import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  WorldRuntimeStore,
  type WorldRuntimeState,
} from "../../web/src/world/runtimeStore";
import {
  ObservationMismatch,
  expectObservationMismatch,
  observe,
} from "./observations";
import { decodeItf, replayRefresh, type TraceState } from "./replay";
import { parseTrace, validateTrace } from "./traces";

const refreshTrace = [
  {
    op: "init",
    s: {
      epoch: 0,
      pending: -1,
      queued: false,
      admitted: -1,
      issued: 0,
      revision: 0,
      status: "idle",
    },
  },
  {
    op: "refresh",
    s: {
      epoch: 0,
      pending: 0,
      queued: false,
      admitted: -1,
      issued: 1,
      revision: 0,
      status: "loading",
    },
  },
  {
    op: "complete",
    s: {
      epoch: 0,
      pending: -1,
      queued: false,
      admitted: 0,
      issued: 1,
      revision: 1,
      status: "ready",
    },
  },
  {
    op: "disconnect",
    s: {
      epoch: 1,
      pending: -1,
      queued: false,
      admitted: 0,
      issued: 1,
      revision: 1,
      status: "error",
    },
  },
] as TraceState[];

function faultyStore(project: (state: WorldRuntimeState) => WorldRuntimeState) {
  return class extends WorldRuntimeStore {
    constructor(...args: ConstructorParameters<typeof WorldRuntimeStore>) {
      super(...args);
      const get = this.get;
      this.get = () => project(get());
    }
  };
}

test("valid admitted connection remains observed across disconnect", async () => {
  await replayRefresh(refreshTrace);
});

for (const [label, project, observation] of [
  [
    "dropped catalogue",
    (s: WorldRuntimeState) => ({ ...s, connections: [] }),
    "refresh.connections.count",
  ],
  [
    "substituted owner",
    (s: WorldRuntimeState) => ({
      ...s,
      connections: s.connections.map((c) => ({
        ...c,
        connectionId: "synthetic-wrong-owner",
      })),
    }),
    "refresh.connection.id",
  ],
  [
    "substituted generation",
    (s: WorldRuntimeState) => ({
      ...s,
      connections: s.connections.map((c) => ({ ...c, generation: 99 })),
    }),
    "refresh.connection.generation",
  ],
] as const) {
  test(`refresh replay detects ${label}`, async () => {
    await assert.rejects(
      () => replayRefresh(refreshTrace, faultyStore(project)),
      (error) =>
        error instanceof ObservationMismatch &&
        error.observation === observation,
    );
  });
}

test("negative control accepts the identified observation mismatch", async () => {
  await expectObservationMismatch(
    () => observe("refresh.status", "error", "ready"),
    ["refresh.status"],
  );
});

for (const unrelated of [
  new TypeError("malformed replay"),
  new Error("cleanup failed"),
  new assert.AssertionError({ message: "trace validation failed" }),
]) {
  test(`negative control propagates unrelated ${unrelated.message}`, async () => {
    await assert.rejects(
      () =>
        expectObservationMismatch(() => {
          throw unrelated;
        }, ["refresh.status"]),
      (error) => error === unrelated,
    );
  });
}

test("negative control rejects a mismatch from a different observation", async () => {
  const error = new ObservationMismatch("spaces.membership", [1], [2]);
  await assert.rejects(
    () =>
      expectObservationMismatch(() => {
        throw error;
      }, ["refresh.status"]),
    (actual) => actual === error,
  );
});

test("negative control fails if replay has no mismatch", async () => {
  await expect(
    expectObservationMismatch(() => {}, ["refresh.status"]),
  ).rejects.toBeInstanceOf(assert.AssertionError);
});

test("trace loading rejects invalid JSON and unsupported ITF before replay", () => {
  expect(() => parseTrace("browser-refresh", "{")).toThrow(SyntaxError);
  expect(() =>
    parseTrace("browser-refresh", JSON.stringify({ states: [{ "#map": [] }] })),
  ).toThrow("unsupported ITF tag");
});

test("ITF decoder rejects coercible integers, malformed sets and mixed tags", () => {
  expect(() => decodeItf({ "#bigint": false })).toThrow("invalid ITF integer");
  expect(() => decodeItf({ "#set": {} })).toThrow("invalid ITF set");
  expect(() => decodeItf({ "#bigint": "1", "#map": [] })).toThrow(
    "unsupported ITF tag",
  );
});

test("allocation domain excludes absent relevant spaces", () => {
  const states = [
    { op: "init", bound: 0, present: [], relevant: [], admitted: [] },
    { op: "allocate", bound: 1, present: [], relevant: [1], admitted: [] },
  ];
  expect(() => validateTrace("space-admission", states)).toThrow(
    "allocation set names an absent space",
  );
});

test("trace validation rejects unknown actions and completion without pending work", () => {
  expect(() =>
    validateTrace("browser-refresh", [
      refreshTrace[0],
      { ...refreshTrace[1], op: "unknown" },
    ]),
  ).toThrow("unknown trace action");
  expect(() =>
    validateTrace("browser-refresh", [refreshTrace[0], refreshTrace[2]]),
  ).toThrow("complete without a pending request");
});

test("intended mutant counterexample fails through the refresh observation", async () => {
  const states = [
    refreshTrace[0],
    refreshTrace[1],
    {
      op: "disconnect",
      s: {
        epoch: 1,
        pending: 0,
        queued: false,
        admitted: -1,
        issued: 1,
        revision: 0,
        status: "error",
      },
    },
    {
      op: "complete",
      s: {
        epoch: 1,
        pending: -1,
        queued: false,
        admitted: 0,
        issued: 1,
        revision: 1,
        status: "ready",
      },
    },
  ];
  const decoded = parseTrace("browser-refresh", JSON.stringify({ states }));
  const mismatch = await expectObservationMismatch(
    () => replayRefresh(decoded),
    ["refresh.status"],
  );
  expect(mismatch.observation).toBe("refresh.status");
});

test("cleanup failure overrides a conformance mismatch instead of counting as a kill", async () => {
  const cleanupError = new Error("synthetic cleanup failure");
  class BadCleanup extends faultyStore((s) => ({ ...s, connections: [] })) {
    override stop() {
      super.stop();
      throw cleanupError;
    }
  }
  await assert.rejects(
    () =>
      expectObservationMismatch(
        () => replayRefresh(refreshTrace, BadCleanup),
        ["refresh.connections.count"],
      ),
    (error) => error === cleanupError,
  );
});
