import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeItf, type TraceState } from "./replay";

export type Model =
  | "runtime-leases"
  | "runtime-control"
  | "browser-refresh"
  | "space-admission";

const actions = {
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
    if (model === "runtime-control") {
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
