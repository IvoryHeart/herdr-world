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

async function fixture(
  runtime: "core" | "tui",
  foreground = { name: "claude", argv: ["claude"] },
) {
  const children: string[][] = [];
  let processReadFails = false;
  const world = await coreWorld({
    foregroundGroups: () => (processReadFails ? null : children),
  });
  cleanups.push(world.dispose);
  await world.connect();
  const terminal = world.fake.create({
    argv: ["bash"],
    pid: 5000,
    reported: true,
    status: { app: "claude", state: "idle" },
    foreground: { pid: 6000, ...foreground },
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
    const pid =
      runtime === "tui" && name === "bash"
        ? f.foreground.shell_pid
        : name === "claude"
          ? 7000
          : 5000;
    if (runtime === "core") {
      if (name) world.fake.foreground(terminal, { pid, name, argv: [name] });
      else world.fake.terminal(terminal)!.foreground = null;
    } else {
      f.foreground.foreground_process_group_id =
        name === "bash" ? f.foreground.shell_pid : pid;
      f.foreground.foreground_processes = name ? [{ pid, name }] : [];
    }
  }
  return {
    world,
    children,
    prompts,
    failProcessRead(value: boolean) {
      processReadFails = value;
    },
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
    async check(kind?: string) {
      const entry = (await f.storage.outbox.forRecord("q-foreground")).find(
        (e) => e.kind === "world.ask.deliver-answer",
      )!;
      expect(entry.state).toBe("refused");
      expect(entry.evidence?.reason).toMatch(/not attached|isn't running/);
      if (kind) expect(entry.evidence?.reason).toContain(`${kind} now`);
      expect(world.fake.deliveredInput).toEqual([]);
      expect(prompts).toEqual([]);
      const page = (await service.rpc("world.ask.deliveries.get", {})) as {
        deliveries: { delivery: { state: string; reason: string } }[];
      };
      expect(page.deliveries[0]!.delivery).toMatchObject({
        state: "refused",
        reason: expect.stringMatching(/not attached|isn't running/),
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
      await f.check("shell");
      // A later agent in this same terminal must never revive the refused send.
      f.detach("claude");
      f.f.time(60000);
      await f.dispatcher.wake();
      await f.check();
    });

for (const name of ["vim", "python", "node", "ssh", "sudo", "psql"])
  test(`TUI: ${name ?? "unknown"} foreground cannot inherit the original ask`, async () => {
    const f = await fixture("tui");
    await f.answer();
    f.detach(name);
    await f.dispatcher.wake();
    await f.check();
  });

for (const runtime of ["core", "tui"] as const)
  for (const name of ["bash", "vim", "tmux", "docker"])
    test(`${runtime}: a ${name} child of the original harness refuses saved answer delivery`, async () => {
      const f = await fixture(runtime);
      await f.answer();
      if (runtime === "core") f.children.push([name]);
      else f.f.foreground.foreground_processes.push({ pid: 6001, name });
      await f.dispatcher.wake();
      await f.check();
    });

for (const harness of ["codex", "pi", "gemini"])
  test(`core: a node-launched ${harness} captures a recipient and delivers through Outbox`, async () => {
    const f = await fixture("core", {
      name: "node",
      argv: ["node", `/opt/${harness}.js`],
    });
    expect(f.recipient?.adapter).toBe("herdr-core");
    await f.answer();
    await f.dispatcher.wake();
    expect(f.world.fake.deliveredInput).toHaveLength(1);
    expect(
      f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state,
    ).toBe("delivered");
  });

test("TUI foreground read failure waits, then rechecks the original recipient", async () => {
  const f = await fixture("tui");
  const call = f.f.lease.runtime.tui.call.bind(f.f.lease.runtime.tui);
  let fail = true;
  f.f.lease.runtime.tui.call = async (method, params, timeout, beforeSend) => {
    if (method === "pane.process_info" && fail) throw new Error("RPC timeout");
    return call(method, params, timeout, beforeSend);
  };
  expect(await f.recipients.resolve(f.recipient)).toMatchObject({
    state: "unresolved",
  });
  await f.answer();
  await f.dispatcher.wake();
  const entries = await f.f.storage.outbox.forRecord("q-foreground");
  expect(entries[0]?.state).not.toBe("refused");
  expect(f.world.fake.deliveredInput).toEqual([]);
  fail = false;
  expect(await f.recipients.resolve(f.recipient)).toMatchObject({
    state: "attached",
  });
});

for (const runtime of ["core", "tui"] as const)
  for (const name of ["claude", "codex", "new-agent"])
    test(`${runtime}: restarted or different ${name} can receive the saved answer`, async () => {
      const f = await fixture(runtime);
      await f.answer();
      f.detach(name);
      await f.world.settle();
      await f.dispatcher.wake();
      expect(
        f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state,
      ).toBe("delivered");
    });

for (const runtime of ["core", "tui"] as const)
  test(`${runtime}: an MCP shell launcher is refused by basename`, async () => {
    const f = await fixture(runtime);
    if (runtime === "core")
      f.children.push(
        ["sh", "-c", "mcp-server"],
        ["node", "/opt/mcp/server.js"],
      );
    else
      f.f.foreground.foreground_processes.push({
        pid: 6001,
        name: "sh",
        argv: ["sh", "-c", "mcp-server"],
      } as never);
    await f.answer();
    await f.dispatcher.wake();
    await f.check("shell");
  });

for (const runtime of ["core", "tui"] as const)
  for (const argv of [
    ["ssh", "example.invalid", "git", "pull"],
    ["python3", "-"],
    ["python3", "tool.py"],
    ["psql", "-c", "select 1"],
    ["sudo", "-n", "example"],
    [],
  ])
    test(`${runtime}: ${argv.length ? argv.join(" ") : "empty cmdline"} child waits and rechecks before saved answer delivery`, async () => {
      const f = await fixture(runtime);
      await f.answer();
      if (runtime === "core") f.children.push(argv);
      else
        f.f.foreground.foreground_processes.push({
          pid: 6001,
          name: argv[0],
          argv,
        } as never);
      await f.dispatcher.wake();
      expect(
        f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state,
      ).toBe("pending");
      const entry = (await f.f.storage.outbox.forRecord("q-foreground"))[0]!;
      expect(entry.state).not.toBe("refused");
      expect(entry.evidence?.reason).not.toMatch(/isn't running|not attached/);
      expect(f.world.fake.deliveredInput).toEqual([]);
      expect(f.prompts).toEqual([]);
      expect(
        await f.cli.handle(
          { command: "ask get", params: { id: "q-foreground" } },
          null,
        ),
      ).toMatchObject({
        ok: true,
        result: { answer: { text: "printf answer_should_not_run" } },
      });
      f.children.length = 0;
      f.f.foreground.foreground_processes.splice(1);
      f.f.time(100000);
      await f.dispatcher.wake();
      expect(
        f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state,
      ).toBe("delivered");
      expect(
        runtime === "core" ? f.world.fake.deliveredInput : f.prompts,
      ).toHaveLength(1);
    });

test("core: failed foreground child reads keep the answer pending with zero writes", async () => {
  const f = await fixture("core");
  await f.answer();
  f.failProcessRead(true);
  await f.dispatcher.wake();
  expect(f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state).toBe(
    "pending",
  );
  expect(f.world.fake.deliveredInput).toEqual([]);
  f.failProcessRead(false);
  f.f.time(100000);
  await f.dispatcher.wake();
  expect(f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state).toBe(
    "delivered",
  );
});
