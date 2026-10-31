import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { WorldLedger, type LedgerStore } from "./world-ledger";
import { createWorldCliService } from "./world-cli-service";
import type { WorldSnapshotResult } from "./snapshot";
import { createAnswerRecorder } from "./answer-record";
import { StorageWriteRejected } from "../storage/world-protocol";
import { tabCardKey } from "../../../shared/terminalColor";

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
  {
    at: "ledger",
    command: "board card pin",
    params: { target: "tab:w1:t1", x: 1, y: 2 },
    outcome: "record",
  },
  {
    at: "ledger",
    command: "undo",
    params: { id: "pending" },
    outcome: "record",
  },
  {
    at: "ledger",
    command: "town desk move",
    params: { target: "tab:w1:t1", herdr: true },
    outcome: "record",
  },
  {
    at: "ledger",
    command: "board card pin",
    params: { target: "tab:w1:t1", x: 1, y: 2 },
    outcome: "rollback",
  },
  {
    at: "ledger",
    command: "board card pin",
    params: { target: "tab:w1:t1", x: 1, y: 2 },
    outcome: "superseded",
  },
  {
    at: "tab-list",
    command: "town desk move",
    params: { target: "tab:w1:t2", herdr: true },
  },
] as const;

test.each(scenarios)(
  "CLI stop at $at keeps $command and its outcome consistent with a current lease",
  async (scenario) => {
    const { at, command } = scenario;
    let params: Record<string, unknown> = scenario.params;
    const outcome = "outcome" in scenario ? scenario.outcome : "refused";
    let holding = command !== "undo";
    const root = mkdtempSync(join(tmpdir(), "world-cli-authorization-"));
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writes: string[] = [];
    const board = new BoardStore(join(root, "board.json"));
    const ledger = new WorldLedger(join(root, "ledger.json"), {
      persist: false,
    });
    const waitAt = async (boundary: string) => {
      if (!holding || at !== boundary) return;
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
        if (holding && (outcome === "rollback" || outcome === "superseded"))
          throw new StorageWriteRejected("Example history write rejected");
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
    const request = (command: string, params: Record<string, unknown>) =>
      service.http(
        new Request("http://world.invalid/api/world/cli", {
          method: "POST",
          body: JSON.stringify({ command, params }),
        }),
        { address: "127.0.0.1", port: 12345 },
        32100,
        () => true,
      );
    const key = tabCardKey("example", "w1:t1", new Set(["w1"]));
    try {
      if (command === "undo") {
        const seed = await request("board card pin", {
          target: "tab:w1:t1",
          x: 1,
          y: 2,
        });
        expect(seed.status).toBe(200);
        params = { id: (await seed.json()).result.id };
        holding = true;
      }
      const before = board.get();
      const pending = request(command, params);
      await arrived.promise;
      if (outcome === "superseded")
        board.patch([{ op: "layout.set", pinned: { [key]: { x: 9, y: 10 } } }]);
      await service.stop();
      expect(lease.isCurrent()).toBe(true);
      release.resolve();
      const response = await pending;
      expect(response.status).toBe(
        outcome === "record" ? 200 : outcome === "refused" ? 403 : 503,
      );
      const body = await response.json();
      if (outcome === "record") {
        expect(body).toMatchObject({
          ok: true,
          command_evidence: { stage: "accepted" },
        });
        const changes = ledger.get().changes;
        expect(changes).toHaveLength(command === "undo" ? 2 : 1);
        expect(changes.at(-1)?.id).toBe(body.result.id);
        expect(changes.at(-1)?.command).toBe(command);
        if (command === "board card pin") {
          expect(board.get().layout.pinned[key]).toEqual({ x: 1, y: 2 });
          expect(changes[0]!.undo).toEqual([
            { op: "layout.set", unpinned: [key] },
          ]);
        } else if (command === "undo") {
          expect(board.get().layout.pinned[key]).toBeUndefined();
          expect(changes[0]!.undone_by).toBe(body.result.id);
        } else {
          expect(changes[0]!.undo).toBeNull();
        }
      } else if (outcome === "rollback" || outcome === "superseded") {
        expect(body).toMatchObject({
          ok: false,
          code: "unavailable",
          command_evidence: { stage: "failed" },
        });
        expect(ledger.get().changes).toEqual([]);
        if (outcome === "rollback")
          expect(board.get().layout).toEqual(before.layout);
        else expect(board.get().layout.pinned[key]).toEqual({ x: 9, y: 10 });
      } else {
        expect(body).toMatchObject({
          ok: false,
          code: "refused",
          command_evidence: { stage: "refused" },
        });
        expect(board.get()).toEqual(before);
        expect(ledger.get()).toMatchObject({
          asks: [],
          changes: [],
          results: [],
        });
      }
      expect(writes).toEqual(
        command === "town desk move" && outcome === "record"
          ? ["tab.move"]
          : [],
      );
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
