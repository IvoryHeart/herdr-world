import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createAskRecipients } from "./ask-recipient";
import { createAnswerRecorder } from "./answer-record";
import { createAnswerDispatcher } from "./answer-dispatch";
import { createWorldCli } from "./world-cli";
import { createWorldCliService } from "./world-cli-service";
import { BoardStore } from "./board-store";
import { askSessionFingerprint, identifyCaller } from "./world-cli-actor";
import type { CliActor } from "./world-ledger";
import { productionAnswerFixture } from "./testing/answer-delivery-fixture";
import { coreCallerSource } from "../herdr-core/ask-caller";
import { coreWorld } from "../herdr-core/testing/core-world";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(runtime: "core" | "tui") {
  const world = await coreWorld();
  cleanups.push(world.dispose);
  await world.connect();
  const terminal = world.fake.create({
    argv: ["bash"],
    pid: 5000,
    reported: true,
    status: { app: "claude", state: "idle" },
    foreground: { pid: 6000, name: "claude", argv: ["claude"] },
  });
  await world.settle();
  let detachDuringInput = false;
  const prompts: string[] = [];
  const f = await productionAnswerFixture(join(world.root, "answers"), {
    async prompt(text) {
      prompts.push(text);
    },
    foregroundRead() {
      if (
        detachDuringInput &&
        f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state ===
          "dispatching"
      )
        detach("bash");
    },
  });
  cleanups.push(f.stop);
  const source = coreCallerSource(() => ({
    manager: world.core.manager,
    host: () => ({}),
  }));
  const recipients = createAskRecipients({
    connections: () => ({
      list: () => [{ id: "studio" }],
      readyRuntimeLease: () => f.lease,
    }),
    core: () => source,
    clock: f.clock,
    incarnation: f.storage.incarnation,
  });
  const actor: CliActor =
    runtime === "core"
      ? (
          await identifyCaller(
            [],
            undefined,
            () => [
              { pid: 6001, ppid: 6000, pgrp: 6000 },
              { pid: 6000, ppid: 5000, pgrp: 6000 },
              { pid: 5000, ppid: 1, pgrp: 5000 },
            ],
            { terminal, source },
          )
        ).actor
      : {
          label: "Synthetic asker",
          verified: true,
          connection_id: "studio",
          connection_generation: 1,
          pane_id: f.info.pane_id,
          terminal_id: f.info.terminal_id,
          agent_session_fingerprint: askSessionFingerprint(
            f.info.agent_session,
          ),
        };
  const recipient = await recipients.capture(actor);
  expect(recipient).toBeDefined();
  await f.storage.ledger.update((doc) =>
    doc.asks.push({
      id: "q-foreground",
      at: 1000,
      actor,
      recipient,
      question: "printf question_should_not_run",
      options: [],
      owner_only: true,
    }),
  );
  const record = createAnswerRecorder({
    ledger: () => f.storage.ledger,
    recipients,
    now: f.clock.now,
  });
  const dispatcher = createAnswerDispatcher({
    ledger: () => f.storage.ledger,
    effects: () => f.storage.effects,
    recipients,
    incarnation: f.storage.incarnation,
    clock: f.clock,
    scheduler: {
      schedule() {
        return { cancel() {} };
      },
    },
    changed() {},
    log() {},
  });
  cleanups.push(() => dispatcher.stop());
  const board = new BoardStore(join(world.root, "board.json"));
  const cli = createWorldCli({
    ledger: f.storage.ledger,
    board,
    hosts: () => [],
    defaultConnectionId: () => null,
    snapshot: async () => {
      throw new Error("Unused snapshot");
    },
    publishBoard() {},
    publishLedger() {},
  });
  const service = createWorldCliService({
    ledger: () => f.storage.ledger,
    effects: () => f.storage.effects,
    attention: () => f.storage.outbox,
    scheduler: f.scheduler,
    clock: f.clock,
    now: f.clock.now,
    incarnation: f.storage.incarnation,
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
  cleanups.push(() => service.stop());
  function detach(name: string | null) {
    const pid = name === "claude" ? 7000 : 5000;
    if (runtime === "core") {
      const record = world.fake.terminal(terminal)!;
      record.foreground = name ? { pid, name, argv: [name] } : null;
    } else {
      f.foreground.foreground_process_group_id =
        name === "bash" ? f.foreground.shell_pid : pid;
      f.foreground.foreground_processes = name ? [{ pid, name }] : [];
    }
  }
  return {
    world,
    f,
    dispatcher,
    recipient,
    recipients,
    cli,
    service,
    detach,
    async answer() {
      await record("q-foreground", "printf answer_should_not_run", {
        kind: "owner",
      });
      f.time(5000);
    },
    async check() {
      const entry = (await f.storage.outbox.forRecord("q-foreground")).find(
        (e) => e.kind === "world.ask.deliver-answer",
      )!;
      expect(entry.state).toBe("refused");
      expect(entry.evidence?.reason).toContain("not attached");
      expect(world.fake.deliveredInput).toEqual([]);
      expect(prompts).toEqual([]);
      const page = (await service.rpc("world.ask.deliveries.get", {})) as {
        deliveries: { delivery: { state: string; reason: string } }[];
      };
      expect(page.deliveries[0]!.delivery).toMatchObject({
        state: "refused",
        reason: expect.stringContaining("not attached"),
      });
      expect(
        await cli.handle(
          { command: "ask get", params: { id: "q-foreground" } },
          null,
        ),
      ).toMatchObject({
        ok: true,
        result: { answer: { text: "printf answer_should_not_run" } },
      });
    },
    duringInput() {
      detachDuringInput = true;
      if (runtime === "core")
        world.fake.onCall = (method) => {
          if (method === "terminal.get") detach("bash");
        };
    },
  };
}

for (const runtime of ["core", "tui"] as const)
  for (const stage of ["answer", "dispatch", "input"] as const)
    test(`${runtime}: an asker exiting to bash before ${stage} keeps its answer retrieval-only`, async () => {
      const f = await fixture(runtime);
      if (stage === "answer") f.detach("bash");
      await f.answer();
      if (stage === "dispatch") f.detach("bash");
      if (stage === "input") f.duringInput();
      await f.dispatcher.wake();
      await f.check();
      // A later agent in this same terminal must never revive the refused send.
      f.detach("claude");
      f.f.time(60000);
      await f.dispatcher.wake();
      await f.check();
    });

for (const name of ["vim", "codex", "claude", null])
  test(`TUI: ${name ?? "unknown"} foreground cannot inherit the original ask`, async () => {
    const f = await fixture("tui");
    await f.answer();
    f.detach(name);
    await f.dispatcher.wake();
    await f.check();
  });
