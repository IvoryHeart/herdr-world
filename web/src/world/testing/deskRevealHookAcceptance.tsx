import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "../../api";
import { useDeskReveal, type DeskRevealAdmission } from "../deskReveal";
import {
  taskSummarySessionFingerprint,
  type WorldLeafObject,
  type WorldObject,
} from "../worldObject";

/** Real hook lifecycle: departure is permanent even when Desk returns before a reply. */
export async function checkDeskRevealHook(
  check: (value: boolean, message: string) => void,
) {
  const session = {
    source: "herdr:codex",
    agent: "codex",
    kind: "id",
    value: "synthetic-hook-session",
  };
  const target = {
    id: "remote-hook-agent",
    kind: "agent",
    connectionId: "beta",
    generation: 7,
    hostLabel: "Synthetic beta",
    actionable: true,
    stale: false,
    terminalId: "same",
    workspaceId: "same",
    tabId: "same",
    agentSessionFingerprint: taskSummarySessionFingerprint(session),
    pane: {
      pane_id: "same",
      terminal_id: "same",
      workspace_id: "same",
      tab_id: "same",
      agent_session: session,
    },
  } as unknown as WorldLeafObject;
  const world = {
    nodeById: new Map([[target.id, target]]),
  } as unknown as WorldObject;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const original = bridge.connection;
  const intent = { current: 1 };
  let ids: readonly string[] | null = ["alpha"];
  let filterWrites = 0,
    admissions = 0;
  let readGate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
  let openGate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
  let readStarted = Promise.withResolvers<void>();
  let openStarted = Promise.withResolvers<void>();
  let received: AbortSignal | undefined;
  let reveal: ReturnType<typeof useDeskReveal>;
  let mounted = true;
  const gates: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const gate = () => {
    const item = Promise.withResolvers<void>();
    gates.push(item);
    return item;
  };
  const jobs: Promise<unknown>[] = [];
  bridge.connection = (() =>
    ({
      connectionId: "beta",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      call: async () => {
        const held = readGate;
        readStarted.resolve();
        await held?.promise;
        return { pane: target.pane };
      },
    }) as unknown as ConnectionClient) as typeof bridge.connection;
  function Harness({ active }: { active: boolean }) {
    reveal = useDeskReveal({
      active,
      intentRequestRef: intent,
      world,
      hostsFilter: {
        ids,
        setIds: (next) => {
          ids = next;
          filterWrites++;
        },
      },
      open: async (
        _leaf,
        _world,
        _sessionId,
        signal,
      ): Promise<DeskRevealAdmission> => {
        received = signal;
        const held = openGate;
        openStarted.resolve();
        await held?.promise;
        if (signal.aborted) return "superseded";
        admissions++;
        return "opened";
      },
    });
    return null;
  }
  const render = (active: boolean) =>
    flushSync(() => root.render(<Harness active={active} />));
  const start = () => {
    const job = reveal(target).catch((reason) => `error: ${String(reason)}`);
    jobs.push(job);
    return job;
  };
  const reset = () => {
    ids = ["alpha"];
    filterWrites = 0;
    admissions = 0;
    received = undefined;
    readGate = null;
    openGate = null;
    readStarted = Promise.withResolvers<void>();
    openStarted = Promise.withResolvers<void>();
    render(true);
  };
  try {
    reset();
    readGate = gate();
    const departed = start();
    await readStarted.promise;
    render(false);
    render(true);
    readGate.resolve();
    check(
      (await departed) === "superseded",
      "Leaving and returning did not supersede a held reveal read",
    );
    check(
      filterWrites === 0 && admissions === 0,
      "A departed reveal widened Hosts or admitted an Inspector after return",
    );

    reset();
    openGate = gate();
    const pendingOpen = start();
    await openStarted.promise;
    render(false);
    check(
      received?.aborted === true,
      "Leaving Desk did not abort queued Inspector admission",
    );
    openGate.resolve();
    check(
      (await pendingOpen) === "superseded" && admissions === 0,
      "Leaving during queued focus admitted an Inspector",
    );

    reset();
    readGate = gate();
    const firstGate = readGate;
    const first = start();
    await readStarted.promise;
    readGate = null;
    check(
      (await start()) === "opened",
      "A newer reveal could not open its current agent",
    );
    firstGate.resolve();
    check(
      (await first) === "superseded" && admissions === 1 && filterWrites === 1,
      "A newer reveal did not permanently supersede its predecessor",
    );

    reset();
    openGate = gate();
    const unmounted = start();
    await openStarted.promise;
    flushSync(() => root.unmount());
    mounted = false;
    check(
      received?.aborted === true,
      "Unmount did not abort queued Inspector admission",
    );
    openGate.resolve();
    check(
      (await unmounted) === "superseded" && admissions === 0,
      "Unmounted Desk admitted an Inspector",
    );
  } finally {
    if (mounted) flushSync(() => root.unmount());
    for (const item of gates) item.resolve();
    await Promise.allSettled(jobs);
    bridge.connection = original;
    container.remove();
  }
}
