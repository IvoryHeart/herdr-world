import assert from "node:assert/strict";
import { creationFixture, type CreationSubjects } from "./creation-fixture";
import * as defaults from "./creation-subjects";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type CreationRequest = {
  phase: string;
  attempt: number;
  retained: boolean;
  mutated: boolean;
  intent: number;
  available: boolean;
  admission: string;
  focus: number;
  finished: boolean;
};
export type CreationState = {
  requests: CreationRequest[];
  live: boolean[];
  intent: number;
};
export async function replayCreationFlow(
  states: TraceState[],
  subjects: CreationSubjects = defaults,
) {
  const f = creationFixture(subjects);
  const { store } = subjects;
  const witnesses = new Set<string>();
  const callerTasks: Promise<void>[] = [];
  const requests = new Map<number, Promise<unknown>>();
  const outcomes = new Map<
    number,
    { state: string; error?: unknown; result?: unknown }
  >();
  const attachments = new Map<number, ReturnType<typeof f.attach>[]>();
  const admissionListeners = new Set<() => void>();
  const admissions = new Map<
    number,
    {
      state: string;
      task: Promise<void>;
      controller: AbortController;
      focusGate: PromiseWithResolvers<void>;
      openTask?: Promise<void>;
      signal?: AbortSignal;
      available: boolean;
      focus: number;
    }
  >();
  let intent = 0;
  let operationFailure: unknown;
  let cleanupFailure: unknown;
  const notify = () => {
    for (const listener of [...admissionListeners]) listener();
  };
  async function settleRequest(h: number) {
    await callerTasks[h];
  }
  async function demanded(h: number) {
    if (
      subjects
        .creationSources()
        .some((source) => source.connectionId === f.ids[h])
    )
      return;
    let off = () => {};
    const ready = new Promise<void>((resolve) => {
      off = subjects.subscribeCreationSources(() => {
        if (
          subjects
            .creationSources()
            .some((source) => source.connectionId === f.ids[h])
        )
          resolve();
      });
    });
    try {
      await Promise.race([
        ready,
        requests.get(h)!.then(
          () => {
            throw new Error("Creation settled before source preparation");
          },
          (error) => {
            throw error;
          },
        ),
      ]);
    } finally {
      off();
    }
  }
  async function openAdmission(h: number, capturedIntent: number) {
    const identity = subjects.createdTerminalIdentity(outcomes.get(h)!.result);
    assert(identity);
    observe("creation.result.identity", identity, {
      paneId: "created-pane",
      terminalId: "created-terminal",
      workspaceId: "shared",
      tabId: "created-tab",
    });
    const controller = new AbortController();
    const focusGate = Promise.withResolvers<void>();
    const current = {
      state: "waiting",
      task: Promise.resolve(),
      controller,
      focusGate,
      available: false,
      focus: 0,
    } as NonNullable<ReturnType<typeof admissions.get>>;
    admissions.set(h, current);
    const task = subjects.admitCreatedTerminal({
      signal: controller.signal,
      timeoutMs: 60_000,
      subscribe: (listener) => {
        admissionListeners.add(listener);
        return () => {
          admissionListeners.delete(listener);
        };
      },
      current: () => ({
        available: current.available,
        observation: String(current.available),
        invalidReason:
          intent !== capturedIntent
            ? "Synthetic newer intent"
            : !f.fixture.bridge.connection(f.ids[h]!, 1).isCurrent()
              ? "Synthetic retired owner"
              : undefined,
      }),
      observe: async () => {},
      open: (signal) => {
        current.state = "opening";
        current.signal = signal;
        current.openTask = focusGate.promise.then(() => {
          if (signal.aborted) throw new Error("Synthetic focus cancelled");
          current.focus++;
        });
        return current.openTask;
      },
    });
    current.task = task.then(
      () => {
        current.state = "opened";
      },
      () => {
        current.state = "rejected";
      },
    );
  }
  try {
    for (const [sequence, state] of states.entries()) {
      const h = state.target;
      const expected = state.creation;
      const before = sequence ? states[sequence - 1]!.creation : expected;
      switch (state.op) {
        case "init":
          break;
        case "start": {
          const promise = store.createQualifiedTab(f.target(h), "shared");
          for (const other of requests.values())
            observe("creation.coalescing.owner", promise === other, false);
          requests.set(h, promise);
          const outcome = { state: "pending" } as {
            state: string;
            error?: unknown;
            result?: unknown;
          };
          outcomes.set(h, outcome);
          const task = promise.then(
            (result) => {
              outcome.state = "created";
              outcome.result = result;
            },
            (error) => {
              outcome.state =
                error instanceof subjects.UncertainRequestError
                  ? "uncertain"
                  : "failed";
              outcome.error = error;
            },
          );
          callerTasks[h] = task;
          await demanded(h);
          break;
        }
        case "duplicate":
          observe(
            "creation.coalescing.duplicate",
            store.createQualifiedTab(f.target(h), "shared"),
            requests.get(h),
          );
          witnesses.add("duplicateCoalesced");
          break;
        case "beginAttach": {
          const attempts = attachments.get(h) ?? [];
          attempts.push(f.attach(h));
          attachments.set(h, attempts);
          break;
        }
        case "oldAck":
          f.ready(attachments.get(h)![0]!);
          witnesses.add("lateAttachmentIgnored");
          break;
        case "attach":
          f.ready(attachments.get(h)!.at(-1)!);
          await f.entered[h]!.promise;
          witnesses.add("sourcePrepared");
          break;
        case "retireAtReady": {
          let retired = false;
          const off = store.subscribe(() => {
            if (
              !retired &&
              f.snapshot(h).terminalAttachments["shared-terminal"]?.ready
            ) {
              retired = true;
              f.retire(h);
            }
          });
          try {
            f.ready(attachments.get(h)!.at(-1)!);
            await settleRequest(h);
          } finally {
            off();
          }
          witnesses.add("readinessRetired");
          break;
        }
        case "retire":
          f.retire(h);
          notify();
          if (
            outcomes.has(h) &&
            ["preparing", "dispatching"].includes(before.requests[h]!.phase)
          )
            await settleRequest(h);
          if (admissions.get(h)?.state === "rejected")
            await admissions.get(h)!.task;
          break;
        case "result":
          f.reply(h);
          await settleRequest(h);
          await openAdmission(h, expected.requests[h]!.intent);
          break;
        case "newIntent":
          intent++;
          notify();
          break;
        case "topology":
          admissions.get(h)!.available = true;
          notify();
          break;
        case "finishFocus": {
          const admission = admissions.get(h)!;
          admission.focusGate.resolve();
          await admission.openTask?.catch((error) => {
            if (
              !(
                admission.signal?.aborted &&
                error.message === "Synthetic focus cancelled"
              )
            )
              throw error;
          });
          await admission.task;
          if (admission.focus) witnesses.add("conditionalFocus");
          break;
        }
        case "lateResult":
          f.reply(h);
          break;
        default:
          throw new Error("Unknown creation flow action");
      }
      await Promise.resolve();
      for (const [h, request] of expected.requests.entries()) {
        observe(
          "creation.retention",
          subjects
            .creationSources()
            .filter((source) => source.connectionId === f.ids[h]).length,
          request.retained ? 1 : 0,
        );
        const actualCalls = f.calls.filter((call) => call.host === h);
        observe(
          "creation.dispatch.count",
          actualCalls.length,
          request.mutated ? 1 : 0,
        );
        for (const call of actualCalls) {
          observe("creation.dispatch.generation", call.generation, 1);
          observe("creation.dispatch.source", call.params.browser_source, {
            workspace_id: "shared",
            tab_id: "shared-tab",
            pane_id: "shared-pane",
            terminal_id: "shared-terminal",
          });
          observe("creation.dispatch.focus", call.params.focus, false);
        }
        const outcome = outcomes.get(h);
        if (outcome)
          observe(
            "creation.outcome",
            outcome.state,
            ["preparing", "dispatching"].includes(request.phase)
              ? "pending"
              : request.phase,
          );
        const pendingReason = subjects.creationPendingReason(
          f.target(h),
          "tab",
          "shared",
        );
        observe(
          "creation.progress",
          pendingReason !== null,
          ["preparing", "dispatching"].includes(request.phase),
        );
        const admission = admissions.get(h);
        if (admission) {
          observe("creation.admission", admission.state, request.admission);
          observe("creation.focus", admission.focus, request.focus);
        }
        if (request.phase === "uncertain") {
          assert(outcome!.error instanceof subjects.UncertainRequestError);
          witnesses.add("uncertainDispatch");
        }
        if (
          request.phase === "created" &&
          request.admission === "rejected" &&
          request.intent !== intent
        )
          witnesses.add("newerIntent");
      }
    }
  } catch (error) {
    operationFailure = error;
  } finally {
    for (const admission of admissions.values()) admission.controller.abort();
    for (const h of [0, 1]) f.retire(h);
    for (const admission of admissions.values()) admission.focusGate.resolve();
    try {
      await Promise.all(callerTasks);
      for (const admission of admissions.values()) {
        await admission.task;
        await admission.openTask?.catch((error) => {
          if (
            !(
              admission.signal?.aborted &&
              error.message === "Synthetic focus cancelled"
            )
          )
            throw error;
        });
      }
      observe(
        "creation.cleanup.retention",
        subjects.creationSources().length,
        0,
      );
      observe("creation.cleanup.listeners", admissionListeners.size, 0);
    } catch (error) {
      cleanupFailure = error;
    } finally {
      f.restore();
    }
  }
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (operationFailure !== undefined) throw operationFailure;
  return witnesses;
}
