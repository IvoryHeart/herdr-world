import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { WorldLedger, type LedgerStore } from "./world-ledger";
import { createWorldCliService } from "./world-cli-service";
import type { WorldSnapshotResult } from "./snapshot";
import { createAnswerRecorder } from "./answer-record";

const scenarios = [
  {
    at: "tab-list",
    command: "town desk move",
    params: { target: "tab:w1:t1", herdr: true },
  },
  {
    at: "native-send",
    command: "town desk move",
    params: { target: "tab:w1:t1", herdr: true },
  },
  {
    at: "snapshot",
    command: "board card pin",
    params: { target: "tab:w1:t1", x: 1, y: 2 },
  },
  {
    at: "snapshot",
    command: "group create",
    params: { kind: "pod", name: "Example pod" },
  },
  { at: "ledger", command: "ask", params: { question: "Example question?" } },
] as const;

test.each(scenarios)(
  "CLI stop at $at refuses $command before its effect despite a current lease",
  async ({ at, command, params }) => {
    const root = mkdtempSync(join(tmpdir(), "world-cli-authorization-"));
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writes: string[] = [];
    const board = new BoardStore(join(root, "board.json"));
    const ledger = new WorldLedger(join(root, "ledger.json"), {
      persist: false,
    });
    const waitAt = async (boundary: string) => {
      if (at !== boundary) return;
      arrived.resolve();
      await release.promise;
    };
    const queuedLedger: LedgerStore = {
      nextId: ledger.nextId.bind(ledger),
      get: ledger.get.bind(ledger),
      ask: ledger.ask.bind(ledger),
      change: ledger.change.bind(ledger),
      openAsks: ledger.openAsks.bind(ledger),
      update: async (change) => {
        await waitAt("ledger");
        return ledger.update(change);
      },
    };
    const tabs = [1, 2].map((id) => ({
      tab_id: `w1:t${id}`,
      workspace_id: "w1",
    }));
    const lease = {
      connectionId: "example",
      generation: 1,
      isCurrent: () => true,
      runtime: {
        sshHost: () => undefined,
        herdr: {
          call: async (
            method: string,
            _params: unknown,
            _timeout: number,
            beforeSend?: () => void,
          ) => {
            if (method === "tab.move") await waitAt("native-send");
            beforeSend?.();
            if (method === "tab.list") {
              await waitAt("tab-list");
              return { tabs };
            }
            writes.push(method);
            return { ok: true };
          },
        },
      },
    };
    const snapshot = {
      connections: [
        {
          connection_id: "example",
          generation: 1,
          snapshot_generation: 1,
          state: "ready",
          actionable: true,
          stale: false,
          snapshot: {
            workspaces: [{ workspace_id: "w1" }],
            tabs,
            panes: [],
            agents: [],
          },
        },
      ],
    } as unknown as WorldSnapshotResult;
    const service = createWorldCliService({
      ledger: () => queuedLedger,
      now: () => 1000,
      board: () => board,
      connections: () => ({
        list: () => [{ id: "example" }],
        defaultId: () => "example",
        readyRuntimeLease: () => lease,
      }),
      snapshots: () => ({
        snapshot: async () => {
          await waitAt("snapshot");
          return snapshot;
        },
      }),
      townMoveQueues: new Map(),
      publishBoard: () => {},
      broadcast: () => {},
    });
    const before = board.get();
    try {
      const pending = service.http(
        new Request("http://world.invalid/api/world/cli", {
          method: "POST",
          body: JSON.stringify({ command, params }),
        }),
        { address: "127.0.0.1", port: 12345 },
        32100,
        () => true,
      );
      await arrived.promise;
      await service.stop();
      expect(lease.isCurrent()).toBe(true);
      release.resolve();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "refused",
        command_evidence: { stage: "refused" },
      });
      expect(writes).toEqual([]);
      expect(board.get()).toEqual(before);
      expect(ledger.get()).toMatchObject({
        asks: [],
        changes: [],
        results: [],
      });
    } finally {
      release.resolve();
      await service.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(["recipient", "ledger"])(
  "answer recording rechecks authorization after held %s work",
  async (at) => {
    const root = mkdtempSync(join(tmpdir(), "answer-authorization-"));
    const ledger = new WorldLedger(join(root, "ledger.json"), {
      persist: false,
    });
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let authorized = true;
    const waitAt = async (boundary: string) => {
      if (boundary !== at) return;
      arrived.resolve();
      await release.promise;
    };
    ledger.update((document) =>
      document.asks.push({
        id: "q-example",
        at: 1000,
        actor: { label: "Example", verified: false },
        question: "Example question?",
        options: [],
        owner_only: false,
      }),
    );
    const record = createAnswerRecorder({
      ledger: () => ({
        nextId: ledger.nextId.bind(ledger),
        get: ledger.get.bind(ledger),
        ask: ledger.ask.bind(ledger),
        change: ledger.change.bind(ledger),
        openAsks: ledger.openAsks.bind(ledger),
        update: async (change) => {
          await waitAt("ledger");
          return ledger.update(change);
        },
      }),
      recipients: {
        authorize: async () => "allowed",
        resolve: async () => {
          await waitAt("recipient");
          return { state: "unresolved", reason: "Example host is offline" };
        },
      },
      now: () => 1000,
    });
    try {
      const pending = record(
        "q-example",
        "Example answer",
        { kind: "owner" },
        () => {
          if (!authorized) throw new Error("authorization revoked");
        },
      );
      await arrived.promise;
      authorized = false;
      release.resolve();
      await expect(pending).rejects.toThrow("authorization revoked");
      expect(ledger.ask("q-example")?.answer).toBeUndefined();
    } finally {
      release.resolve();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
