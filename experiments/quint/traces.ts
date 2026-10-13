import type { PreparationState } from "./browser-preparation";
import type { DrainState } from "./runtime-drain";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeItf, type TraceState } from "./replay";

export type Model =
  | "runtime-drain"
  | "browser-preparation"
  | "runtime-leases"
  | "runtime-control"
  | "browser-refresh"
  | "space-admission";

const actions = {
  "runtime-drain": ["init", "choose", "retire", "finishFirst", "finishSecond"],
  "browser-preparation": [
    "init",
    "request",
    "reply",
    "project",
    "prepareOffice",
    "admit",
    "failure",
    "disconnect",
    "retire",
  ],
  "runtime-control": [
    "init",
    "start",
    "currentError",
    "stop",
    "replace",
    "remove",
    "finishCleanup",
    "failCleanup",
    "shutdown",
    "duplicateStart",
    "duplicateStop",
    "deniedStart",
    "obsoleteError",
    "clearError",
  ],
  "runtime-leases": [
    "init",
    "start",
    "finishStart",
    "capture",
    "stop",
    "finishStop",
    "obsoleteError",
  ],
  "browser-refresh": ["init", "refresh", "disconnect", "complete"],
  "space-admission": ["init", "allocate"],
};

function record(value: unknown): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid trace record",
  );
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Infinity,
): asserts value is number {
  assert(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum,
    "invalid trace integer",
  );
}

export function validateTrace(
  model: Model,
  value: unknown,
): asserts value is TraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty trace");
  for (const [index, state] of value.entries()) {
    record(state);
    assert(
      typeof state.op === "string" && actions[model].includes(state.op),
      "unknown trace action",
    );
    assert(
      index === 0 ? state.op === "init" : state.op !== "init",
      "invalid initialization order",
    );
    if (model === "runtime-drain") {
      record(state.drain);
      integer(state.drain.kind, -1, 5);
      integer(state.drain.gen, 0, 3);
      for (const key of [
        "cleanupFirst",
        "failed",
        "transportDone",
        "cleanupDone",
        "readySeen",
      ])
        assert(typeof state.drain[key] === "boolean", "invalid drain flag");
      assert(
        ["empty", "starting", "draining", "half", "done"].includes(
          String(state.drain.stage),
        ),
        "invalid drain stage",
      );
      assert(
        [
          "absent",
          "connecting",
          "stopping",
          "error",
          "removed",
          "disconnected",
        ].includes(String(state.drain.phase)),
        "invalid drain phase",
      );
      if (index > 0) {
        const before: DrainState = value[index - 1].drain;
        const valid: boolean =
          state.op === "choose"
            ? ["empty", "done"].includes(before.stage)
            : state.op === "retire"
              ? before.stage === "starting"
              : state.op === "finishFirst"
                ? before.stage === "draining" && before.kind !== 5
                : before.stage === "half" ||
                  (before.stage === "draining" && before.kind === 5);
        assert(valid, "invalid drain action precondition");
      }
    } else if (model === "browser-preparation") {
      record(state.preparation);
      for (const key of ["epoch", "issued", "revision"])
        integer(state.preparation[key], 0, 3);
      for (const key of ["captured", "published"])
        integer(state.preparation[key], -1, 3);
      assert(
        ["idle", "request", "decode", "object", "admission"].includes(
          String(state.preparation.stage),
        ),
        "invalid preparation stage",
      );
      assert(
        ["idle", "loading", "ready", "error"].includes(
          String(state.preparation.status),
        ),
        "invalid preparation status",
      );
      assert(
        typeof state.preparation.catalogue === "boolean",
        "invalid catalogue flag",
      );
      for (const key of ["live", "actionable"])
        assert(
          Array.isArray(state.preparation[key]) &&
            state.preparation[key].length === 2 &&
            state.preparation[key].every(
              (v: unknown) => typeof v === "boolean",
            ),
          "invalid host authority",
        );
      integer(state.target, -1, 1);
      assert(
        state.op === "retire" ? state.target >= 0 : state.target === -1,
        "invalid preparation target",
      );
      if (index > 0) {
        const previous: PreparationState = value[index - 1].preparation;
        const from: Record<string, string> = {
          request: "idle",
          reply: "request",
          project: "decode",
          prepareOffice: "object",
          admit: "admission",
          failure: "request",
        };
        if (from[state.op])
          assert(
            previous.stage === from[state.op],
            "invalid preparation action precondition",
          );
        if (state.op === "retire")
          assert(
            previous.live[state.target],
            "retirement without current owner",
          );
      }
    } else if (model === "runtime-control") {
      record(state.control);
      integer(state.control.gen, 0, 6);
      integer(state.control.factory, 0, 2);
      integer(state.control.runtimeFactory, -1, 2);
      integer(state.control.runtimeGen, -1, 6);
      assert(
        ["down", "ready", "error", "stopping", "removed"].includes(
          String(state.control.phase),
        ),
        "invalid control phase",
      );
      assert(
        ["none", "stop", "replace", "remove", "shutdown"].includes(
          String(state.control.mode),
        ),
        "invalid cleanup mode",
      );
      assert(
        typeof state.control.blocked === "boolean",
        "invalid shutdown marker",
      );
      if (index > 0) {
        const previous = value[index - 1].control;
        const phase = previous.phase;
        const guards: Record<string, boolean> = {
          start: phase === "down" && !previous.blocked,
          currentError: phase === "ready",
          stop:
            ["ready", "error"].includes(phase) && previous.runtimeFactory >= 0,
          replace:
            ["down", "ready", "error"].includes(phase) && !previous.blocked,
          remove:
            ["down", "ready", "error"].includes(phase) && !previous.blocked,
          finishCleanup: phase === "stopping",
          failCleanup: phase === "stopping",
          shutdown:
            ["down", "ready", "error"].includes(phase) && !previous.blocked,
          duplicateStart: phase === "ready" && !previous.blocked,
          duplicateStop: phase === "stopping" && previous.mode !== "remove",
          deniedStart:
            previous.blocked ||
            phase === "removed" ||
            previous.mode === "remove",
          obsoleteError:
            previous.runtimeGen >= 0 && previous.runtimeGen < previous.gen,
          clearError: phase === "error" && previous.runtimeFactory === -1,
        };
        assert(guards[state.op], "invalid runtime control action precondition");
      }
    } else if (model === "browser-refresh") {
      record(state.s);
      integer(state.s.epoch, 0, 3);
      for (const key of ["issued", "revision"]) integer(state.s[key], 0, 6);
      for (const key of ["pending", "admitted"]) integer(state.s[key], -1, 3);
      assert(typeof state.s.queued === "boolean", "invalid refresh queue");
      assert(
        typeof state.s.status === "string" &&
          ["idle", "loading", "ready", "error"].includes(state.s.status),
        "invalid refresh status",
      );
      if (state.op === "complete") {
        assert(
          value[index - 1].s.pending >= 0,
          "complete without a pending request",
        );
      }
    } else if (model === "runtime-leases") {
      assert(
        Array.isArray(state.hosts) && state.hosts.length === 2,
        "invalid runtime hosts",
      );
      integer(state.target, -1);
      assert(
        state.op === "init"
          ? state.target === -1
          : state.target === 0 || state.target === 1,
        "invalid runtime target",
      );
      for (const host of state.hosts) {
        record(host);
        integer(host.gen, 0, 4);
        integer(host.startGen, -1, 4);
        integer(host.lease, -1, 4);
        assert(typeof host.pending === "boolean", "invalid start pending flag");
        assert(
          typeof host.phase === "string" &&
            ["down", "starting", "ready", "stopping"].includes(host.phase),
          "invalid runtime phase",
        );
      }
    } else {
      integer(state.bound, 0);
      assert(
        (state.bound as number) <= 6,
        "allocation capacity exceeds model domain",
      );
      for (const key of ["present", "relevant", "admitted"]) {
        const ids: unknown = state[key];
        assert(
          Array.isArray(ids) && new Set(ids).size === ids.length,
          "invalid allocation set",
        );
        for (const id of ids) {
          integer(id, 0);
          assert(id <= 5, "allocation ID exceeds model domain");
        }
      }
      const present = new Set(state.present as number[]);
      assert(
        (state.relevant as number[]).every((id) => present.has(id)) &&
          (state.admitted as number[]).every((id) => present.has(id)),
        "allocation set names an absent space",
      );
    }
  }
}

export function parseTrace(model: Model, json: string): TraceState[] {
  const raw = JSON.parse(json);
  record(raw);
  const states = decodeItf(raw.states);
  validateTrace(model, states);
  return states;
}

export async function loadTrace(path: string, model: Model) {
  return parseTrace(model, await readFile(path, "utf8"));
}
