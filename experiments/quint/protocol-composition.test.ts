import { expect, test } from "bun:test";
import { WorldSnapshotAdmission } from "../../server/src/bridge/world-snapshot-admission";
import { sendWorldSnapshotReply } from "../../server/src/bridge/world-snapshot-reply";
import { WORLD_SNAPSHOT_CHUNK_CHARACTERS } from "../../shared/worldSnapshotChunks";
import { WorldRuntimeStore } from "../../web/src/world/runtimeStore";
import { syntheticBridge, SyntheticSocket } from "./bridge-fixture";

function response() {
  return {
    revision: 1,
    observed_at: 1,
    padding: "synthetic ".repeat(
      Math.ceil((WORLD_SNAPSHOT_CHUNK_CHARACTERS * 4) / 10),
    ),
    connections: ["synthetic-a", "synthetic-b"].map((id, h) => ({
      connection_id: id,
      label: id,
      source: "synthetic",
      is_default: h === 0,
      state: "ready",
      generation: 1,
      snapshot_generation: 1,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [],
        tabs: [],
        panes: [],
        agents: [],
        coverage: {
          workspaces: 0,
          tabs: 0,
          panes: 0,
          agent_panes: 0,
          status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
          by_workspace: [],
        },
      },
    })),
  };
}
for (const scenario of [
  "healthy",
  "runtime-retirement",
  "transport-retirement",
]) {
  test(`real chunk sender/credit/Bridge/observation composition: ${scenario}`, async () => {
    const fixture = syntheticBridge(undefined, undefined, true);
    const socket = fixture.sockets[0]!;
    const admission = new WorldSnapshotAdmission(1000);
    class RecordingStore extends WorldRuntimeStore {
      owner!: Promise<void>;
      override refresh() {
        const task = super.refresh();
        this.owner = task;
        return task;
      }
    }
    const store = new RecordingStore(fixture.bridge);
    const jobs: Promise<{ error?: unknown }>[] = [];
    let chunks = 0;
    let credits = 0;
    let partialObservationHidden = false;
    const close = socket.onclose;
    socket.onclose = () => {
      admission.retire(socket);
      close?.();
    };
    socket.onSend = (message) => {
      if (message.world_snapshot_admitted) {
        credits++;
        if (scenario === "runtime-retirement") fixture.connect([false, true]);
        admission.acknowledge(socket, message);
        return;
      }
      if (message.method !== "world.snapshot") return;
      expect(message.accept_world_snapshot_chunk_admission).toBe(true);
      const transfer = admission.open(socket, String(message.id));
      const task = sendWorldSnapshotReply(
        String(message.id),
        response(),
        true,
        (raw) => {
          chunks++;
          const frame = JSON.parse(raw);
          socket.receive(frame);
          if (frame.world_snapshot_chunk?.index === 3) {
            partialObservationHidden =
              store.get().status === "loading" &&
              store.get().connections.length === 0;
            if (scenario === "transport-retirement")
              fixture.bridge.disconnect("Synthetic transport retirement");
          }
          return true;
        },
        () => socket.readyState === SyntheticSocket.OPEN,
        (index) => transfer.wait(index),
      ).finally(() => transfer.close());
      jobs.push(
        task.then(
          () => ({}),
          (error) => ({ error }),
        ),
      );
    };
    store.start();
    try {
      await store.owner;
      const outcomes = await Promise.all(jobs);
      expect(partialObservationHidden).toBe(true);
      expect(jobs).toHaveLength(1);
      if (scenario === "transport-retirement") {
        expect(chunks).toBe(4);
        expect(credits).toBe(0);
        expect(outcomes[0]!.error).toBeInstanceOf(Error);
        expect((outcomes[0]!.error as Error).message).toContain("retired");
        expect(store.get().status).toBe("error");
        expect(store.get().connections).toHaveLength(0);
      } else {
        expect(chunks).toBeGreaterThan(4);
        expect(credits).toBeGreaterThan(0);
        expect(outcomes[0]!.error).toBeUndefined();
        expect(store.get().status).toBe("ready");
        const [alpha, beta] = store.get().connections;
        expect(alpha!.actionable).toBe(scenario === "healthy");
        expect(alpha!.stale).toBe(scenario !== "healthy");
        expect(beta!.actionable).toBe(true);
        expect(beta!.stale).toBe(false);
      }
    } finally {
      store.stop();
      fixture.bridge.disconnect();
      admission.retire(socket);
      await Promise.all(jobs);
      fixture.restore();
    }
  });
}
