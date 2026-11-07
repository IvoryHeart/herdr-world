import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger } from "../../storage/world-storage";
import { systemScheduler, type Scheduler } from "../../service/ports";
import { handleDeskRpc } from "../../rpc/desk";
import type { BridgeRpcContext } from "../../rpc/context";
import { WorldDeskStore } from "../../../../web/src/world/deskStateStore";
import {
  deskIdentity,
  deskMetadata,
} from "../../../../web/src/world/useDeskState";
import { handoffId, receiptIdentity } from "../../../../web/src/world/handoffs";
import type { WorldLeafObject } from "../../../../web/src/world/worldObject";
import { PersistentTerminalMarks } from "../persistent-terminal-marks";
import { WorldDeskRegistry } from "../desk-state";
import { WorldWatchlistRegistry } from "../watchlist";
import { deskSessionFingerprint } from "../desk-observation";

export function reviewPane(index = 0, value = `session-${index}`) {
  return {
    pane_id: `pane-${index}`,
    terminal_id: `terminal-${index}`,
    agent: "codex",
    agent_session: { source: "synthetic", agent: "codex", kind: "id", value },
    agent_status: "done",
    state_change_seq: 4,
  };
}

/** Real SQLite worker, RPC admission and browser consumers; no external runtime. */
export async function reviewStopFixture(seed?: {
  root: string;
  panes: Record<string, unknown>[];
  time?: number;
  scheduler?: Scheduler;
}) {
  const root = seed?.root ?? mkdtempSync(join(tmpdir(), "review-stops-"));
  let time = seed?.time ?? 1000,
    generation = 1,
    current = true;
  let panes: Record<string, unknown>[] = seed?.panes ?? [reviewPane()];
  const clock = { now: () => time, monotonic: () => time };
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
  let storage = await openWorldLedger(paths, {
    clock,
    scheduler: systemScheduler,
  });
  let registries = makeRegistries();
  const failures: unknown[] = [];
  function makeRegistries() {
    return {
      desk: new WorldDeskRegistry(),
      watchlist: new WorldWatchlistRegistry(),
    };
  }
  function makeMarks() {
    return new PersistentTerminalMarks({
      storage: storage.terminalMarks,
      incarnation: `service-${generation}`,
      registries,
      now: clock.now,
      scheduler: seed?.scheduler,
      changed() {},
      failed: (error) => {
        failures.push(error);
      },
      lease() {
        const captured = generation;
        return {
          generation: captured,
          isCurrent: () => current && generation === captured,
          runtime: {
            herdr: { call: async () => ({ panes: structuredClone(panes) }) },
          },
        };
      },
    });
  }
  let marks = makeMarks();
  const client = {
    async call(method: string, params?: Record<string, unknown>) {
      let result: unknown, failure: unknown;
      await handleDeskRpc({
        id: "review-test",
        method,
        params,
        services: { persistentMarks: marks, worldDesk: registries.desk },
        sendReply: (reply: { result: unknown }) => {
          result = reply.result;
          return true;
        },
        sendError: (_context: string, error: unknown) => {
          failure = error;
        },
      } as unknown as BridgeRpcContext);
      if (failure) throw failure;
      return result;
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  };
  const browsers = [new WorldDeskStore(client), new WorldDeskStore(client)];
  const refresh = () =>
    Promise.all(browsers.map((browser) => browser.refresh()));
  const leaf = (index = 0) =>
    ({
      id: `leaf:alpha:pane-${index}`,
      terminalId: `terminal-${index}`,
      connectionId: "alpha",
      generation,
      agentSessionFingerprint: deskSessionFingerprint(
        panes[index]?.agent_session,
      ),
      kind: "agent",
      status: panes[index]?.agent_status,
      lastActivityAt:
        typeof panes[index]?.last_activity_at === "number" &&
        Number(panes[index]?.last_activity_at) > 0
          ? panes[index]!.last_activity_at
          : undefined,
    }) as WorldLeafObject;
  const stop = (index = 0, browser = browsers[0]!) => {
    const agent = leaf(index),
      metadata = deskMetadata([agent], browser.get());
    return JSON.parse(
      handoffId(
        agent,
        metadata.stops.get(receiptIdentity(agent)),
        metadata.stopIds.get(receiptIdentity(agent)),
      ),
    )[1] as string;
  };
  return {
    client,
    browsers,
    refresh,
    leaf,
    stop,
    failures,
    get storage() {
      return storage;
    },
    get marks() {
      return marks;
    },
    get registries() {
      return registries;
    },
    setPanes(value: Record<string, unknown>[]) {
      panes = value;
    },
    advance(ms: number) {
      time += ms;
    },
    async observe() {
      await marks.observe("alpha", generation, panes, ++time);
      await refresh();
    },
    async review(index = 0, reviewed = true, stopId = stop(index)) {
      const accepted = await browsers[0]!.mutate(
        "world.desk.review",
        deskIdentity(leaf(index)),
        { stop_id: stopId, reviewed },
      );
      await refresh();
      return accepted;
    },
    async restart() {
      await marks.close();
      await storage.close();
      generation++;
      time++;
      storage = await openWorldLedger(paths, {
        clock,
        scheduler: systemScheduler,
      });
      registries = makeRegistries();
      marks = makeMarks();
      // Composition-root startup transitions must not evict unresolved known
      // captures before their first fresh source classification.
      marks.retire("alpha", generation, false, true);
      marks.retire("alpha", generation, true, true);
      for (const browser of browsers) browser.stop();
      browsers.splice(
        0,
        browsers.length,
        new WorldDeskStore(client),
        new WorldDeskStore(client),
      );
      await refresh();
    },
    retire() {
      current = false;
      marks.retire("alpha", generation, false);
    },
    async close() {
      await marks.close();
      await storage.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
