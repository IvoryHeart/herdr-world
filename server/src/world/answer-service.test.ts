import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BoardStore } from "./board-store";
import { createWorldCliService } from "./world-cli-service";
import { productionAnswerFixture } from "./testing/answer-delivery-fixture";

// Real loopback socket ownership exercises the service's caller verification,
// capture/record/ACK hooks. No production service or external runtime is used.
test.skipIf(process.platform !== "linux")(
  "service wires verified CLI ask, owner answer, stdout ACK and independent delivery notices",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "answer-service-"));
    const prompts: string[] = [],
      lines: string[] = [];
    const f = await productionAnswerFixture(root, {
      prompt: async (text) => {
        prompts.push(text);
      },
    });
    const peer = {
      ...f.info,
      pane_id: "w1:p2",
      terminal_id: "term-peer",
      agent_session: {
        ...f.info.agent_session,
        value: "synthetic-peer-session",
      },
    };
    const lease = {
      ...f.lease,
      runtime: {
        ...f.lease.runtime,
        herdr: {
          call: async (
            method: string,
            params: Record<string, unknown> = {},
          ) => {
            if (params.pane_id === peer.pane_id && method === "pane.get")
              return { pane: peer };
            if (
              params.pane_id === peer.pane_id &&
              method === "pane.process_info"
            )
              return { process_info: { shell_pid: process.pid } };
            return f.lease.runtime.herdr.call(method, params);
          },
        },
      },
    };
    const board = new BoardStore(join(root, "board.json"));
    const service = createWorldCliService({
      ledger: () => f.storage.ledger,
      attention: () => f.storage.outbox,
      effects: () => f.storage.effects,
      scheduler: f.scheduler,
      clock: f.clock,
      now: f.clock.now,
      incarnation: f.storage.incarnation,
      board: () => board,
      connections: () => ({
        list: () => [{ id: "studio" }],
        defaultId: () => "studio",
        readyRuntimeLease: (id) => (id === "studio" ? lease : null),
      }),
      snapshots: () => null,
      townMoveQueues: new Map(),
      publishBoard: () => {
        throw new Error("Answer delivery must not publish Board");
      },
      broadcast: (line) => lines.push(line),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        return service.http(
          request,
          server.requestIP(request),
          server.port!,
          () => true,
        );
      },
    });
    const command = async (
      command: string,
      params: Record<string, unknown>,
      paneId = f.info.pane_id,
    ) => {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          "const response = await fetch(process.argv[1], { method: 'POST', body: process.argv[2] }); console.log(await response.text());",
          `http://127.0.0.1:${server.port}/api/world/cli`,
          JSON.stringify({
            command,
            params,
            caller: { pane_id: paneId },
          }),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [body, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code) throw new Error(error);
      return JSON.parse(body);
    };
    try {
      const asked = await command("ask", {
        question: "Send without waiting?",
        owner_only: true,
      });
      expect(asked).toMatchObject({ ok: true, actor: { verified: true } });
      const id = asked.result.id;
      expect(f.storage.ledger.ask(id)?.recipient?.connection_id).toBe("studio");
      await service.rpc("world.ask.answer", {
        id,
        answer: "The stored answer",
      });
      expect((await service.rpc("world.asks.get", {})) as any).toMatchObject({
        asks: [],
      });
      const page = (await service.rpc("world.ask.deliveries.get", {})) as any;
      expect(page.deliveries).toHaveLength(1);
      const { ask, delivery } = page.deliveries[0];
      expect(delivery.state).toBe("pending");
      const read = await command("ask get", { id });
      expect(read).toMatchObject({
        ok: true,
        result: {
          answer: {
            text: "The stored answer",
            occurrence: ask.answer.occurrence,
          },
        },
      });
      lines.length = 0;
      expect(
        await command("ask acknowledge", {
          id,
          occurrence: ask.answer.occurrence,
          attempt: delivery.attempt,
        }),
      ).toMatchObject({ ok: true });
      expect(lines.map((line) => JSON.parse(line).control.type)).toEqual([
        "world_ask_delivery_changed",
      ]);
      expect(
        ((await service.rpc("world.ask.deliveries.get", {})) as any).deliveries,
      ).toEqual([]);
      const peerQuestion = await command("ask", {
        question: "Can a peer answer this?",
      });
      lines.length = 0;
      expect(
        await command(
          "ask answer",
          { id: peerQuestion.result.id, answer: "A peer answer" },
          peer.pane_id,
        ),
      ).toMatchObject({ ok: true });
      expect(lines.map((line) => JSON.parse(line).control.type)).toContain(
        "world_ask_delivery_changed",
      );
      expect(
        ((await service.rpc("world.ask.deliveries.get", {})) as any).deliveries,
      ).toHaveLength(1);
      lines.length = 0;
      expect(
        await command("ask withdraw", { id: peerQuestion.result.id }),
      ).toMatchObject({ ok: true });
      expect(lines.map((line) => JSON.parse(line).control.type)).toContain(
        "world_ask_delivery_changed",
      );
      expect(
        ((await service.rpc("world.ask.deliveries.get", {})) as any).deliveries,
      ).toEqual([]);
      expect(
        await service.rpc("world.ask.delivery.get", {
          id,
          occurrence: ask.answer.occurrence,
        }),
      ).toMatchObject({ delivery: { state: "delivered", received_at: 1000 } });
      expect(
        await service.rpc("world.ask.delivery.get", {
          id,
          occurrence: "a-stale",
        }),
      ).toBeNull();
      f.time(100_000);
      service.start();
      await service.stop();
      expect(prompts).toEqual([]);
    } finally {
      await service.stop();
      await server.stop(true);
      await f.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("owner recovery requires a duplicate decision and fences stale decisions without reopening questions", async () => {
  const root = mkdtempSync(join(tmpdir(), "answer-decisions-"));
  const f = await productionAnswerFixture(root);
  const board = new BoardStore(join(root, "board.json"));
  const service = createWorldCliService({
    ledger: () => f.storage.ledger,
    attention: () => f.storage.outbox,
    effects: () => f.storage.effects,
    incarnation: f.storage.incarnation,
    scheduler: f.scheduler,
    clock: f.clock,
    now: f.clock.now,
    board: () => board,
    connections: () => ({
      list: () => [],
      defaultId: () => null,
      readyRuntimeLease: () => null,
    }),
    snapshots: () => null,
    townMoveQueues: new Map(),
    publishBoard() {},
    broadcast() {},
  });
  try {
    await f.seed();
    const entry = (await f.entry())!;
    const fence = {
      connection_id: "studio",
      generation: 1,
      service_incarnation: f.storage.incarnation,
    };
    f.time(4000);
    const claim = (await f.storage.outbox.claim(entry.id, fence))!;
    await f.storage.outbox.beginDispatch(entry.id, claim.attempt, fence);
    await f.storage.outbox.finish(
      entry.id,
      claim.attempt,
      "uncertain",
      "Synthetic response lost after possible send",
    );
    const ask = f.storage.ledger.ask("q-native")!;
    const params = {
      id: ask.id,
      occurrence: ask.answer!.occurrence,
      attempt: claim.attempt,
    };
    await expect(
      service.rpc("world.ask.delivery.resend", params),
    ).rejects.toThrow("confirm");
    await service.rpc("world.ask.delivery.resend", {
      ...params,
      confirm_duplicate: true,
    });
    let staleError = "";
    try {
      await service.rpc("world.ask.delivery.close", params);
    } catch (error) {
      staleError = String(error);
    }
    expect(staleError).toContain("changed");
    const current = (await f.entry())!;
    await service.rpc("world.ask.delivery.close", {
      ...params,
      attempt: current.attempt,
    });
    expect((await f.entry())?.state).toBe("cancelled");
    expect(f.storage.ledger.ask(ask.id)?.answer?.text).toBe(
      "Stored fixture answer",
    );
    expect(f.storage.ledger.openAsks().asks).toEqual([]);
  } finally {
    await service.stop();
    await f.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
