import { effectActions, validateEffectTrace } from "./effect-recovery";
import { validateObservationTrace } from "./observation-traces";
import type { RecoveryState } from "./ranger-recovery";
import type { AuthorityState } from "./ranger-authority";
import type { PreparationState } from "./browser-preparation";
import type { DrainState } from "./runtime-drain";
import type { AssemblyState } from "./chunk-assembly";
import type { CreationState } from "./creation-flow";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeItf, type TraceState } from "./replay";

import { verificationModels } from "./models";
export type Model = (typeof verificationModels)[number];

const actions = {
  "effect-recovery": effectActions,
  "observation-base": [
    "init",
    "request",
    "reply",
    "apply",
    "change",
    "retire",
    "browserRetire",
    "drop",
    "restart",
    "disconnect",
  ],
  "ranger-recovery": [
    "init",
    "capture",
    "save",
    "failedSave",
    "close",
    "reopen",
    "runtimeReplacement",
    "endpointReplacement",
    "bootReplacement",
    "workspaceReplacement",
    "recover",
  ],
  "ranger-authority": [
    "init",
    "prepare",
    "execute",
    "checked",
    "release",
    "duplicate",
    "revoke",
    "stopTask",
    "dispose",
    "retire",
    "replaceWorkspace",
    "mutateInput",
  ],
  "creation-flow": [
    "init",
    "start",
    "duplicate",
    "beginAttach",
    "oldAck",
    "attach",
    "retireAtReady",
    "retire",
    "result",
    "newIntent",
    "topology",
    "finishFocus",
    "lateResult",
  ],
  "chunk-assembly": [
    "init",
    "call",
    "fragment",
    "duplicate",
    "outOfOrder",
    "wrongTotal",
    "qualifiedChunk",
    "finishDecode",
    "disconnect",
    "reconnect",
    "oldSocket",
  ],
  "chunk-credits": ["init", "open", "wait", "acknowledge", "close", "retire"],
  "runtime-drain": [
    "init",
    "choose",
    "enterBackground",
    "retire",
    "finishFirst",
    "finishSecond",
  ],
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
    "priority",
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

export type ReplayDomain = {
  generationBound?: number;
  epochBound?: number;
  requestBound?: number;
};

export function validateTrace(
  model: Model,
  value: unknown,
  domain: ReplayDomain = {},
): asserts value is TraceState[] {
  assert(
    domain.generationBound === undefined ||
      [4, 6, 8].includes(domain.generationBound),
    "unsupported generation domain",
  );
  assert(
    domain.epochBound === undefined || [3, 4, 5].includes(domain.epochBound),
    "unsupported epoch domain",
  );
  assert(
    domain.requestBound === undefined ||
      [3, 4, 6, 10].includes(domain.requestBound),
    "unsupported request domain",
  );
  if (model === "effect-recovery") return validateEffectTrace(value);
  if (model === "observation-base") return validateObservationTrace(value);
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
    if (model === "ranger-recovery") {
      record(state.recovery);
      integer(state.recovery.generation, 1, 3);
      assert(
        state.recovery.generation !== 2,
        "unsupported recovery generation",
      );
      for (const key of [
        "captured",
        "saved",
        "opened",
        "loaded",
        "endpoint",
        "boot",
        "workspace",
        "recovered",
      ])
        assert(
          typeof state.recovery[key] === "boolean",
          "invalid recovery state",
        );
      assert(
        ["none", "accepted", "rejected"].includes(
          String(state.recovery.result),
        ),
        "invalid recovery result",
      );
      if (index > 0) {
        const before: RecoveryState = value[index - 1].recovery;
        const valid: boolean =
          state.op === "capture"
            ? !before.captured
            : state.op === "save"
              ? before.captured &&
                !before.saved &&
                before.opened &&
                before.generation === 1 &&
                before.endpoint &&
                before.boot &&
                before.workspace
              : state.op === "failedSave" || state.op === "close"
                ? before.saved && before.opened
                : state.op === "reopen"
                  ? before.saved && !before.opened
                  : state.op === "runtimeReplacement"
                    ? before.saved && before.generation === 1
                    : state.op === "recover"
                      ? before.loaded && before.result === "none"
                      : before.saved &&
                        !before.recovered &&
                        before[
                          state.op === "endpointReplacement"
                            ? "endpoint"
                            : state.op === "bootReplacement"
                              ? "boot"
                              : "workspace"
                        ];
        assert(valid, "invalid recovery action precondition");
      }
    } else if (model === "ranger-authority") {
      record(state.authority);
      assert(
        ["idle", "prepared", "checking", "dispatch", "done"].includes(
          String(state.authority.phase),
        ),
        "invalid Ranger phase",
      );
      integer(state.authority.writes, 0, 1);
      for (const key of [
        "permission",
        "taskActive",
        "serviceActive",
        "runtimeCurrent",
        "workspaceCurrent",
      ])
        assert(
          typeof state.authority[key] === "boolean",
          "invalid Ranger authority",
        );
      assert(
        ["none", "failed", "succeeded"].includes(
          String(state.authority.result),
        ),
        "invalid Ranger result",
      );
      if (index > 0) {
        const before: AuthorityState = value[index - 1].authority;
        const valid: boolean =
          state.op === "prepare"
            ? before.phase === "idle"
            : state.op === "execute"
              ? before.phase === "prepared"
              : state.op === "checked"
                ? before.phase === "checking"
                : state.op === "release"
                  ? before.phase === "dispatch"
                  : state.op === "duplicate"
                    ? ["checking", "dispatch", "done"].includes(before.phase)
                    : state.op === "mutateInput"
                      ? before.phase !== "idle"
                      : state.op === "replaceWorkspace"
                        ? before.workspaceCurrent && before.phase === "prepared"
                        : !["idle", "done"].includes(before.phase) &&
                          before[
                            state.op === "revoke"
                              ? "permission"
                              : state.op === "stopTask"
                                ? "taskActive"
                                : state.op === "dispose"
                                  ? "serviceActive"
                                  : "runtimeCurrent"
                          ];
        assert(valid, "invalid Ranger action precondition");
      }
    } else if (model === "creation-flow") {
      record(state.creation);
      integer(state.creation.intent, 0, 2);
      integer(state.target, -1, 1);
      assert(
        Array.isArray(state.creation.live) &&
          state.creation.live.length === 2 &&
          state.creation.live.every(
            (value: unknown) => typeof value === "boolean",
          ),
        "invalid creation owner lifetime",
      );
      assert(
        Array.isArray(state.creation.requests) &&
          state.creation.requests.length === 2,
        "invalid creation requests",
      );
      for (const request of state.creation.requests) {
        record(request);
        integer(request.attempt, 0, 2);
        integer(request.intent, -1, 2);
        integer(request.focus, 0, 1);
        for (const key of ["retained", "mutated", "available", "finished"])
          assert(typeof request[key] === "boolean", "invalid creation flag");
        assert(
          [
            "idle",
            "preparing",
            "dispatching",
            "created",
            "failed",
            "uncertain",
          ].includes(String(request.phase)),
          "invalid creation phase",
        );
        assert(
          ["none", "waiting", "opening", "opened", "rejected"].includes(
            String(request.admission),
          ),
          "invalid focus admission",
        );
      }
      if (index > 0) {
        const before: CreationState = value[index - 1].creation;
        assert(
          state.op === "newIntent" ? state.target === -1 : state.target >= 0,
          "invalid creation target",
        );
        const h = state.target as number;
        const request = before.requests[h];
        const valid: boolean =
          state.op === "start"
            ? request!.phase === "idle" && before.live[h]
            : state.op === "duplicate"
              ? ["preparing", "dispatching"].includes(request!.phase)
              : state.op === "beginAttach"
                ? request!.phase === "preparing" && request!.attempt < 2
                : state.op === "oldAck"
                  ? request!.phase === "preparing" && request!.attempt === 2
                  : ["attach", "retireAtReady"].includes(state.op)
                    ? request!.phase === "preparing" && request!.attempt > 0
                    : state.op === "retire"
                      ? before.live[h]
                      : state.op === "result"
                        ? request!.phase === "dispatching"
                        : state.op === "newIntent"
                          ? before.intent < 2
                          : state.op === "topology"
                            ? request!.admission === "waiting"
                            : state.op === "finishFocus"
                              ? ["opening", "rejected"].includes(
                                  request!.admission,
                                ) && !request!.finished
                              : request!.phase === "uncertain";
        assert(valid, "invalid creation action precondition");
      }
    } else if (model === "chunk-assembly") {
      record(state.assembly);
      integer(state.assembly.epoch, 0, 2);
      integer(state.assembly.calls, 0, 4);
      assert(
        typeof state.assembly.connected === "boolean" &&
          typeof state.assembly.acceptedOld === "boolean",
        "invalid assembly lifetime",
      );
      assert(
        Array.isArray(state.assembly.cells) &&
          state.assembly.cells.length === 2,
        "invalid assembly cells",
      );
      integer(state.target, -1, 1);
      for (const cell of state.assembly.cells) {
        record(cell);
        integer(cell.next, 0, 3);
        integer(cell.ordinal, 0, 4);
        integer(cell.epoch, 0, 2);
        for (const key of ["decoded", "finished", "aborted"])
          assert(typeof cell[key] === "boolean", "invalid decoder state");
        assert(
          ["empty", "collecting", "decoding", "done", "failed"].includes(
            String(cell.phase),
          ),
          "invalid assembly phase",
        );
      }
      if (index > 0) {
        const before: AssemblyState = value[index - 1].assembly;
        assert(
          ["disconnect", "reconnect"].includes(state.op)
            ? state.target === -1
            : state.target >= 0,
          "invalid assembly target",
        );
        const h = state.target as number;
        const cell = before.cells[h];
        const invalid = [
          "duplicate",
          "outOfOrder",
          "wrongTotal",
          "qualifiedChunk",
        ].includes(state.op);
        const valid: boolean =
          state.op === "call"
            ? before.connected &&
              before.calls < 4 &&
              ["empty", "done", "failed"].includes(cell!.phase) &&
              cell!.finished
            : state.op === "fragment"
              ? cell!.phase === "collecting"
              : invalid
                ? ["collecting", "decoding"].includes(cell!.phase) &&
                  (state.op !== "duplicate" || cell!.next > 0) &&
                  (state.op !== "wrongTotal" ||
                    (cell!.phase === "collecting" && cell!.next > 0))
                : state.op === "finishDecode"
                  ? cell!.decoded && !cell!.finished
                  : state.op === "disconnect"
                    ? before.connected && before.epoch < 2
                    : state.op === "reconnect"
                      ? !before.connected
                      : before.connected &&
                        before.epoch > 0 &&
                        cell!.phase === "collecting" &&
                        cell!.next === 2;
        assert(valid, "invalid assembly action precondition");
      }
    } else if (model === "chunk-credits") {
      assert(
        Array.isArray(state.slots) && state.slots.length === 4,
        "invalid credit slots",
      );
      assert(
        Array.isArray(state.live) &&
          state.live.length === 2 &&
          state.live.every((v: unknown) => typeof v === "boolean"),
        "invalid socket lifetime",
      );
      for (const slot of state.slots) {
        record(slot);
        assert(
          ["new", "open", "waiting", "closed"].includes(String(slot.phase)),
          "invalid credit slot phase",
        );
        integer(slot.index, -1, 2);
        assert(
          slot.phase === "waiting" ? slot.index >= 0 : slot.index === -1,
          "invalid credit phase/index",
        );
      }
      integer(state.socket, -1, 1);
      integer(state.id, -1, 2);
      integer(state.index, -1, 2);
      integer(state.releasedSocket, -1, 1);
      integer(state.releasedIndex, -1, 2);
      integer(state.releasedId, -1, 2);
      assert(
        typeof state.released === "boolean" &&
          typeof state.rejected === "boolean",
        "invalid credit event",
      );
      if (index > 0) {
        assert(
          state.socket >= 0 &&
            (state.op === "retire" ? state.id === -1 : state.id >= 0),
          "invalid credit target",
        );
        const previous: TraceState = value[index - 1];
        if (["open", "wait", "close"].includes(state.op))
          assert(
            state.socket === 0 || state.id === 0,
            "invalid modeled credit handle",
          );
        if (state.op === "retire")
          assert(previous.live[state.socket], "invalid socket retirement");
        const slot = previous.slots[state.socket === 0 ? state.id : 3];
        if (state.op === "open")
          assert(
            previous.live[state.socket] && slot.phase !== "closed",
            "invalid open precondition",
          );
        if (state.op === "wait" || state.op === "close")
          assert(slot.phase !== "new", "invalid credit handle precondition");
        if (["wait", "acknowledge"].includes(state.op))
          assert(state.index >= 0, "invalid credit index");
      }
    } else if (model === "runtime-drain") {
      record(state.drain);
      integer(state.drain.kind, -1, 5);
      integer(state.drain.gen, 0, 3);
      for (const key of [
        "cleanupFirst",
        "failed",
        "transportDone",
        "backgroundWait",
        "backgroundFailed",
        "backgroundDone",
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
        if (state.op === "choose")
          assert(
            state.drain.kind >= 0 &&
              (!state.drain.backgroundFailed || state.drain.backgroundWait) &&
              (state.drain.kind !== 5 ||
                (!state.drain.backgroundWait && !state.drain.cleanupFirst)),
            "invalid drain scenario configuration",
          );
        const valid: boolean =
          state.op === "choose"
            ? ["empty", "done"].includes(before.stage)
            : state.op === "enterBackground"
              ? before.stage === "starting" &&
                before.backgroundWait &&
                !before.transportDone
              : state.op === "retire"
                ? before.stage === "starting" &&
                  (!before.backgroundWait || before.transportDone)
                : state.op === "finishFirst"
                  ? before.stage === "draining" && before.kind !== 5
                  : before.stage === "half" ||
                    (before.stage === "draining" && before.kind === 5);
        assert(valid, "invalid drain action precondition");
      }
    } else if (model === "browser-preparation") {
      record(state.preparation);
      integer(state.preparation.epoch, 0, domain.epochBound ?? 3);
      for (const key of ["issued", "revision"])
        integer(state.preparation[key], 0, domain.requestBound ?? 3);
      for (const key of ["captured", "published"])
        integer(state.preparation[key], -1, domain.epochBound ?? 3);
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
        typeof state.preparation.queued === "boolean",
        "invalid preparation queue",
      );
      integer(state.preparation.selected, -1, 1);
      integer(state.preparation.requested, -1, 1);
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
        ["retire", "priority"].includes(state.op)
          ? state.target >= 0
          : state.target === -1,
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
      integer(state.control.gen, 0, domain.generationBound ?? 6);
      integer(state.control.factory, 0, 2);
      integer(state.control.runtimeFactory, -1, 2);
      integer(state.control.runtimeGen, -1, domain.generationBound ?? 6);
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
      integer(state.s.epoch, 0, domain.epochBound ?? 3);
      for (const key of ["issued", "revision"])
        integer(state.s[key], 0, domain.requestBound ?? 6);
      for (const key of ["pending", "admitted"])
        integer(state.s[key], -1, domain.epochBound ?? 3);
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
        integer(host.gen, 0, domain.generationBound ?? 4);
        integer(host.startGen, -1, domain.generationBound ?? 4);
        integer(host.lease, -1, domain.generationBound ?? 4);
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

export function parseTrace(
  model: Model,
  json: string,
  domain: ReplayDomain = {},
): TraceState[] {
  const raw = JSON.parse(json);
  record(raw);
  let states = decodeItf(raw.states);
  if (model === "creation-flow" && Array.isArray(states))
    states = states.map((state) => {
      record(state);
      const { requests, live, intent, ...event } = state;
      return { ...event, creation: { requests, live, intent } };
    });
  if (model === "chunk-assembly" && Array.isArray(states))
    states = states.map((state) => {
      record(state);
      const { cells, epoch, connected, calls, acceptedOld, ...event } = state;
      return {
        ...event,
        assembly: { cells, epoch, connected, calls, acceptedOld },
      };
    });
  validateTrace(model, states, domain);
  return states;
}

export async function loadTrace(
  path: string,
  model: Model,
  domain: ReplayDomain = {},
) {
  return parseTrace(model, await readFile(path, "utf8"), domain);
}
