import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { openWorldLedger } from "../storage/world-storage";
import { createAskRecipients } from "../world/ask-recipient";
import { createAnswerRecorder } from "../world/answer-record";
import { createAnswerDispatcher } from "../world/answer-dispatch";
import { productionAnswerFixture } from "../world/testing/answer-delivery-fixture";
import { identifyCoreAsker } from "./ask-recipient";
import { identifyWorldCaller } from "../world/world-cli-actor";
import { coreWorld, until } from "./testing/core-world";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const world = await coreWorld();
  cleanups.push(world.dispose);
  await world.connect();
  const terminal = world.fake.create({
    argv: ["claude"],
    reported: true,
    status: { state: "idle", app: "claude" },
    foreground: {
      pid: 12345,
      name: "claude",
      argv: ["claude"],
      cwd: "/example",
    },
  });
  await world.settle();
  const actor = identifyCoreAsker(world.core.manager, terminal, () => [
    { pid: 12346, ppid: 12345, pgrp: 12345 },
    { pid: 12345, ppid: 1, pgrp: 12345 },
  ])!.actor;
  expect(actor.verified).toBe(true);
  let now = 1000;
  const clock = { now: () => now, monotonic: () => now };
  const scheduler = {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  };
  const storage = await openWorldLedger(
    {
      database: join(world.root, "world.sqlite"),
      ledger: join(world.root, "legacy.json"),
    },
    { clock, scheduler },
  );
  cleanups.push(() => storage.close());
  const recipients = createAskRecipients({
    connections: () => ({ list: () => [], readyRuntimeLease: () => null }),
    core: () => world.core.manager,
    clock,
    incarnation: storage.incarnation,
  });
  const recipient = await recipients.capture(actor);
  expect(recipient?.adapter).toBe("herdr-core");
  await storage.ledger.update((doc) =>
    doc.asks.push({
      id: "q-core",
      at: now,
      actor,
      recipient,
      question: "Proceed?",
      options: [],
      owner_only: true,
    }),
  );
  const record = createAnswerRecorder({
    ledger: () => storage.ledger,
    recipients,
    now: () => now,
  });
  const dispatcher = createAnswerDispatcher({
    ledger: () => storage.ledger,
    effects: () => storage.effects,
    incarnation: storage.incarnation,
    recipients,
    clock,
    scheduler: {
      schedule() {
        return { cancel() {} };
      },
    },
    changed() {},
    log() {},
  });
  cleanups.push(() => dispatcher.stop());
  return {
    world,
    terminal,
    storage,
    recipients,
    recipient,
    actor,
    dispatcher,
    async answer() {
      await record("q-core", "Proceed", { kind: "owner" });
      now = 5000;
    },
    entry: async () =>
      (await storage.outbox.forRecord("q-core")).find(
        (e) => e.kind === "world.ask.deliver-answer",
      )!,
  };
}

test("core and TUI durable answers reach the same delivered World state once", async () => {
  const f = await fixture();
  await f.answer();
  await f.dispatcher.wake();
  await f.dispatcher.wake();
  expect((await f.entry()).state).toBe("delivered");
  expect(f.world.fake.deliveredInput).toHaveLength(1);
  expect(f.world.fake.deliveredInput[0]!.input).toContain(
    "Answer from owner: Proceed",
  );
  const tui = await productionAnswerFixture(join(f.world.root, "tui"));
  cleanups.push(tui.stop);
  await tui.seed();
  tui.time(5000);
  await tui.dispatcher.wake();
  expect((await tui.entry())!.state).toBe((await f.entry()).state);
});

test("a replaced core asker is refused and the saved answer remains readable", async () => {
  const f = await fixture();
  await f.answer();
  f.world.fake.replaceWithShell(f.terminal);
  await f.world.settle();
  await f.dispatcher.wake();
  expect((await f.entry()).state).toBe("refused");
  expect(f.world.fake.deliveredInput).toEqual([]);
  expect(f.storage.ledger.ask("q-core")!.answer!.text).toBe("Proceed");
});

test("a lost core after durable dispatch is uncertain and never auto-replayed", async () => {
  const f = await fixture();
  await f.answer();
  f.world.fake.holdSends = true;
  const sending = f.dispatcher.wake();
  await until(() => f.world.fake.heldSendCount === 1);
  f.world.fake.kill(f.world.socket);
  await sending;
  await f.dispatcher.wake();
  expect((await f.entry()).state).toBe("uncertain");
  expect(
    f.world.fake.calls.filter((call) => call.method === "terminal.send"),
  ).toHaveLength(1);
});

test("core CLI claims need local process ancestry; address labels confer no authority", async () => {
  const f = await fixture();
  expect(
    identifyCoreAsker(f.world.core.manager, f.terminal, null),
  ).toBeUndefined();
  expect(
    identifyCoreAsker(f.world.core.manager, f.terminal, () => [
      { pid: 98765, ppid: 1, pgrp: 98765 },
    ]),
  ).toBeUndefined();
  expect(
    await f.recipients.capture({ ...f.actor, verified: false }),
  ).toBeUndefined();
});

test("inherited core and TUI markers choose the nearest verified ancestor", async () => {
  const f = await fixture();
  const hosts = [
    {
      connection_id: "tui",
      generation: 1,
      local: true,
      call: async (method: string) =>
        method === "pane.process_info"
          ? { process_info: { shell_pid: 200 } }
          : {
              pane: {
                pane_id: "w1:p1",
                terminal_id: "tui-term",
                agent: "claude",
              },
            },
    },
  ];
  const core = async () => ({ actor: f.actor, distance: 1 });
  for (const [distance, expected] of [
    [0, "tui"],
    [2, "box"],
  ] as const) {
    const chain = Array.from({ length: 3 }, (_, index) => ({
      pid: index === distance ? 200 : 300 + index,
      ppid: 1,
      pgrp: 200,
    }));
    const found = await identifyWorldCaller(
      hosts,
      { pane_id: "w1:p1", core_terminal_id: f.terminal },
      () => chain,
      core,
    );
    expect(found.actor.connection_id).toBe(expected);
  }
  const ambiguous = await identifyWorldCaller(
    hosts,
    { pane_id: "w1:p1", core_terminal_id: f.terminal },
    () => [
      { pid: 300, ppid: 200, pgrp: 200 },
      { pid: 200, ppid: 1, pgrp: 200 },
    ],
    core,
  );
  expect(ambiguous.actor.verified).toBe(false);
  const unresolved = await identifyWorldCaller(
    hosts,
    { pane_id: "w1:p1", core_terminal_id: f.terminal },
    () => [{ pid: 200, ppid: 1, pgrp: 200 }],
    async () => undefined,
  );
  expect(unresolved.actor.verified).toBe(false);
});
