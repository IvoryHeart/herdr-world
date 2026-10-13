import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeItf, type TraceState } from "./replay";

export type Model = "runtime-leases" | "browser-refresh" | "space-admission";

const actions = {
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
    if (model === "browser-refresh") {
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
