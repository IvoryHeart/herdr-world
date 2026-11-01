import { useEffect, useRef, useSyncExternalStore } from "react";
import { bridge } from "../api";
import { store } from "../store";
import { deskClient, type DeskClients } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";
import {
  deskReadKey,
  type DeskReadKind,
  type DeskReadNotice,
  type DeskReadTarget,
} from "../../../shared/deskAcquisition";
import { DeskWatchClient } from "./deskWatchClient";

const watches = new DeskWatchClient({
  enabled: () =>
    bridge.status === "connected" &&
    bridge.hello?.capabilities?.world_shared_acquisition === true,
  visible: () =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
  epoch: () => bridge.connectionEpoch,
  declare: (targets) => bridge.call("world.desk.observe", targets),
  changed(listener) {
    const hello = bridge.onHello(listener),
      status = bridge.onStatus(listener),
      owners = store.subscribe(listener);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", listener);
    return () => {
      hello();
      status();
      owners();
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", listener);
    };
  },
  reads: (listener) => bridge.onControl(listener),
  retry(callback) {
    const timer = setTimeout(callback, 5000);
    return { cancel: () => clearTimeout(timer) };
  },
});

/** One hook contributes chosen targets; only the service acquires while negotiated. */
export function useDeskWatch(
  kind: DeskReadKind,
  leaves: WorldLeafObject[],
  clients: DeskClients,
  receive: (frame: DeskReadNotice, leaf: WorldLeafObject) => void,
  trigger?: (leaf: WorldLeafObject) => string,
): boolean {
  const owner = useRef({});
  const mode = useSyncExternalStore(watches.subscribe, watches.getSnapshot);
  const targets = leaves.map((leaf) => ({
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    pane_id: leaf.pane.pane_id,
    session: leaf.agentSessionFingerprint ?? null,
    ...(trigger ? { trigger: trigger(leaf) } : {}),
  }));
  const key = JSON.stringify(targets);
  useEffect(() => {
    const member = owner.current;
    if (!watches.enabled()) {
      watches.release(member);
      return;
    }
    const byKey = new Map(
      leaves.map((leaf, index) => [deskReadKey(kind, targets[index]!), leaf]),
    );
    const current = (target: DeskReadTarget) => {
      const leaf = byKey.get(deskReadKey(kind, target));
      return !!leaf && !!deskClient(clients, leaf);
    };
    watches.watch(
      member,
      kind,
      targets,
      (frame) => {
        const leaf = byKey.get(deskReadKey(kind, frame));
        if (leaf) receive(frame, leaf);
      },
      current,
    );
    // key includes the complete target declaration, including receipt triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, key, kind, mode, receive]);
  useEffect(() => {
    const member = owner.current;
    return () => watches.release(member);
  }, []);
  return watches.enabled();
}
