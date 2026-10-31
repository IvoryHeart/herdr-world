import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  bridge,
  type BridgeControlMsg,
  type BridgeHello,
  type ConnectionClient,
} from "../../api";
import type {
  DeskDeclaration,
  DeskReadNotice,
} from "../../../../shared/deskAcquisition";
import { usePaneScreens } from "../paneScreen";
import { useTurnReceipts, type ReceiptState } from "../handoffs";
import type { WorldLeafObject } from "../worldObject";

/** Real hooks with a synthetic negotiated socket; the old fixture covers initial fallback. */
export async function runSharedDeskWatchChecks(
  check: (condition: boolean, message: string) => void,
) {
  let enabled = true,
    epoch = 1,
    hidden = false;
  const original = {
    call: bridge.call,
    onHello: bridge.onHello,
    onStatus: bridge.onStatus,
    onControl: bridge.onControl,
  };
  const properties = ["hello", "status", "connectionEpoch"] as const;
  const descriptors = properties.map(
    (key) => [key, Object.getOwnPropertyDescriptor(bridge, key)] as const,
  );
  const visibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  const helloListeners = new Set<(hello: BridgeHello) => void>(),
    controls = new Set<(control: BridgeControlMsg) => void>();
  const declarations: DeskDeclaration[] = [],
    direct: string[] = [];
  const declared: {
    predicate: (value: DeskDeclaration) => boolean;
    resolve(): void;
  }[] = [];
  let renders = 0;
  let latest: { screen?: string; receipt: ReceiptState } = {
    receipt: { receipt: null, current: false },
  };
  const rendered: { after: number; predicate(): boolean; resolve(): void }[] =
    [];
  const nextRender = (predicate: () => boolean = () => true) =>
    new Promise<void>((resolve) =>
      rendered.push({ after: renders, predicate, resolve }),
    );
  const nextDeclaration = (predicate: (value: DeskDeclaration) => boolean) =>
    new Promise<void>((resolve) => declared.push({ predicate, resolve }));
  const fingerprint = "a".repeat(64);
  let leaf = {
    id: "shared-agent",
    connectionId: "shared",
    generation: 1,
    status: "done",
    kind: "agent",
    agentSessionFingerprint: fingerprint,
    pane: {
      pane_id: "pane-shared",
      workspace_id: "workspace-shared",
      tab_id: "tab-shared",
      agent: "codex",
    },
  } as WorldLeafObject;
  const reply = (id: string) => ({
    agent_session_fingerprint: fingerprint,
    turn: {
      turn_id: id,
      ask: "synthetic request",
      report: "synthetic report",
      started_at: null,
      ended_at: null,
      duration_ms: null,
      tool_calls: 0,
      commands: 0,
      files: [],
      files_truncated: false,
    },
  });
  const client = {
    connectionId: "shared",
    generation: 1,
    serverRuntimeGeneration: 1,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    async call(method: string) {
      direct.push(method);
      return method === "pane.read"
        ? { text: "legacy screen" }
        : reply("legacy-turn");
    },
  } as ConnectionClient;
  function Probe() {
    const screen = usePaneScreens([leaf], client),
      receipt = useTurnReceipts([leaf], client);
    latest = { screen: screen(leaf), receipt: receipt(leaf) };
    renders++;
    for (const waiter of [...rendered])
      if (renders > waiter.after && waiter.predicate()) {
        rendered.splice(rendered.indexOf(waiter), 1);
        waiter.resolve();
      }
    return <span>{latest.screen}</span>;
  }
  const mount = document.createElement("div");
  document.body.append(mount);
  let root = createRoot(mount);
  const emit = (frame: DeskReadNotice) => {
    for (const callback of controls) callback(frame);
  };
  const screenFrame = (text: string): DeskReadNotice => ({
    type: "world_desk_reads",
    kind: "screen",
    connection_id: "shared",
    connection_generation: 1,
    pane_id: "pane-shared",
    session: fingerprint,
    trigger: null,
    result: { text },
  });
  const receiptFrame = (
    trigger: string | null,
    error?: string,
  ): DeskReadNotice => ({
    ...screenFrame(""),
    kind: "receipt",
    trigger,
    ...(error
      ? { result: undefined, error, failures: 999 }
      : { result: reply("shared-turn") }),
  });
  const hello: BridgeHello = {
    hello: true,
    bridge_protocol_version: 2,
    default_connection_id: "shared",
    capabilities: { world_shared_acquisition: true },
  };
  Object.defineProperty(bridge, "hello", {
    configurable: true,
    get: () => ({
      ...hello,
      capabilities: { world_shared_acquisition: enabled },
    }),
  });
  Object.defineProperty(bridge, "status", {
    configurable: true,
    get: () => "connected",
  });
  Object.defineProperty(bridge, "connectionEpoch", {
    configurable: true,
    get: () => epoch,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  bridge.onHello = (callback) => {
    helloListeners.add(callback);
    return () => {
      helloListeners.delete(callback);
    };
  };
  bridge.onStatus = () => () => {};
  bridge.onControl = (callback) => {
    controls.add(callback);
    return () => {
      controls.delete(callback);
    };
  };
  bridge.call = (async (method: string, params?: Record<string, unknown>) => {
    if (method !== "world.desk.observe")
      return original.call.call(bridge, method, params);
    const value = params as unknown as DeskDeclaration;
    declarations.push(value);
    for (const waiter of [...declared])
      if (waiter.predicate(value)) {
        declared.splice(declared.indexOf(waiter), 1);
        waiter.resolve();
      }
    return { ok: true };
  }) as typeof bridge.call;
  try {
    let ready = nextDeclaration(
      (value) => value.screens.length === 1 && value.receipts.length === 1,
    );
    flushSync(() => root.render(<Probe />));
    await ready;
    check(
      !latest.screen && !latest.receipt.current,
      "shared Desk waits for actual reads without placeholders",
    );
    check(
      direct.length === 0,
      "negotiated Desk hooks perform no direct pane or turn reads",
    );
    let painted = nextRender(
      () =>
        latest.receipt.receipt?.turn_id === "shared-turn" &&
        !latest.receipt.current,
    );
    emit(receiptFrame(null));
    await painted;
    check(
      !latest.receipt.current,
      "a late-holder receipt is shown but never current",
    );
    const firstTrigger =
      declarations[declarations.length - 1]!.receipts[0]!.trigger;
    painted = nextRender(() => latest.receipt.current);
    emit(receiptFrame(firstTrigger));
    await painted;
    check(
      latest.receipt.current,
      "an identical receipt read for the current trigger becomes markable",
    );
    ready = nextDeclaration(
      (value) => value.receipts[0]?.trigger !== firstTrigger,
    );
    leaf = { ...leaf, status: "idle", lastActivityAt: 2000 };
    flushSync(() => root.render(<Probe />));
    await ready;
    check(
      latest.receipt.receipt?.turn_id === "shared-turn" &&
        !latest.receipt.current,
      "a new stop retains its old receipt as stale",
    );
    const trigger = declarations[declarations.length - 1]!.receipts[0]!.trigger;
    painted = nextRender();
    emit(receiptFrame(trigger, "synthetic failure"));
    await painted;
    check(
      latest.receipt.receipt?.turn_id === "shared-turn" &&
        !latest.receipt.current,
      "the first failure retains the previous receipt regardless of the wire counter",
    );
    painted = nextRender(
      () => latest.receipt.current && latest.receipt.receipt === null,
    );
    emit(receiptFrame(trigger, "synthetic failure"));
    await painted;
    check(
      latest.receipt.current && latest.receipt.receipt === null,
      "a second same-trigger failure settles as no receipt",
    );
    painted = nextRender(() => latest.screen === "shared screen");
    emit(screenFrame("shared screen"));
    await painted;
    ready = nextDeclaration(
      (value) => !value.screens.length && !value.receipts.length,
    );
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await ready;
    emit(screenFrame("hidden stale screen"));
    ready = nextDeclaration(
      (value) => value.screens.length === 1 && value.receipts.length === 1,
    );
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await ready;
    check(
      latest.screen === "shared screen",
      "hidden Desk releases interest and rejects in-flight screens",
    );
    ready = nextDeclaration(
      (value) => !value.screens.length && !value.receipts.length,
    );
    flushSync(() => root.unmount());
    await ready;
    check(
      direct.length === 0,
      "closing negotiated Desk does not restart browser reads",
    );
    root = createRoot(mount);
    ready = nextDeclaration(
      (value) => value.screens.length === 1 && value.receipts.length === 1,
    );
    flushSync(() => root.render(<Probe />));
    await ready;
    const count = declarations.length;
    painted = nextRender(
      () =>
        latest.screen === "legacy screen" &&
        latest.receipt.receipt?.turn_id === "legacy-turn",
    );
    enabled = false;
    epoch++;
    for (const callback of [...helloListeners])
      callback({ ...hello, capabilities: {} });
    await painted;
    check(
      direct.includes("pane.read") && direct.includes("agent_turn.get"),
      "capability removal restores both legacy browser read paths",
    );
    check(
      declarations.length === count,
      "fallback never calls an unsupported Desk observation method",
    );
    flushSync(() => {
      emit(screenFrame("disabled push"));
      root.render(<Probe />);
    });
    check(
      latest.screen === "legacy screen",
      "fallback ignores pushed Desk reads",
    );
  } finally {
    flushSync(() => root.unmount());
    mount.remove();
    Object.assign(bridge, original);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(bridge, key, descriptor);
      else delete (bridge as unknown as Record<string, unknown>)[key];
    }
    if (visibility)
      Object.defineProperty(document, "visibilityState", visibility);
    else
      delete (document as unknown as Record<string, unknown>).visibilityState;
  }
}
