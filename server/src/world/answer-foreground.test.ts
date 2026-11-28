import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createAskRecipients, RESTART_UNPROVED } from "./ask-recipient";
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

/** A World run before the current one, over the same stores and runtime. */
const EARLIER_RUN = "synthetic-earlier-run";

async function fixture(
  runtime: "core" | "tui",
  foreground = { name: "claude", argv: ["claude"] },
  /** The question was asked in an earlier World run. */
  earlierRun = false,
) {
  const children: string[][] = [];
  const world = await coreWorld({
    foregroundGroups: () => children,
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
  const recipientsFor = (incarnation: string) =>
    createAskRecipients({
      connections: () => ({
        list: () => [{ id: "studio" }],
        readyRuntimeLease: () => f.lease,
      }),
      core: () => source,
      clock: f.clock,
      incarnation,
    });
  const recipients = recipientsFor(f.storage.incarnation);
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
  const recipient = await recipientsFor(
    earlierRun ? EARLIER_RUN : f.storage.incarnation,
  ).capture(actor);
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
    f,
    dispatcher,
    recipient,
    recipients,
    cli,
    service,
    detach,
    async answer(by = record) {
      await by("q-foreground", "printf answer_should_not_run", {
        kind: "owner",
      });
      f.time(5000);
    },
    /** Records the answer as the earlier World run did, before restarting. */
    recordEarlier: createAnswerRecorder({
      ledger: () => f.storage.ledger,
      recipients: recipientsFor(EARLIER_RUN),
      now: f.clock.now,
    }),
    /** Another harness session takes the asker's terminal. */
    replaceSession() {
      if (runtime === "core")
        world.fake.foreground(terminal, {
          pid: 7100,
          name: "claude",
          argv: ["claude"],
        });
      else f.info.agent_session.value = `${f.info.agent_session.value}-other`;
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
  for (const name of [
    "bash",
    "vim",
    "tmux",
    "docker",
    "ssh",
    "python3",
    "psql",
    "sudo",
  ])
    test(`${runtime}: ignores a ${name} child of the foreground harness`, async () => {
      const f = await fixture(runtime);
      if (runtime === "core") f.children.push([name]);
      else f.f.foreground.foreground_processes.unshift({ pid: 6001, name });
      await f.answer();
      await f.dispatcher.wake();
      expect(
        f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state,
      ).toBe("delivered");
      expect(
        runtime === "core" ? f.world.fake.deliveredInput : f.prompts,
      ).toHaveLength(1);
    });

test("TUI without foreground information retains saved-answer delivery", async () => {
  const f = await fixture("tui");
  f.f.foreground.foreground_processes.length = 0;
  await f.answer();
  await f.dispatcher.wake();
  expect(f.f.storage.ledger.ask("q-foreground")?.delivery?.answer?.state).toBe(
    "delivered",
  );
  expect(f.prompts).toHaveLength(1);
});

for (const runtime of ["core", "tui"] as const)
  for (const when of ["before", "after"] as const)
    for (const same of [true, false])
      test(`${runtime}: an answer ${when === "before" ? "saved before" : "given after"} a World restart reaches ${same ? "only the proven original" : "no replacement"} session`, async () => {
        const f = await fixture(runtime, undefined, true);
        if (when === "before") await f.answer(f.recordEarlier);
        // World restarts; the runtime and its generation number carry on.
        if (!same) f.replaceSession();
        await f.world.settle();
        if (when === "after") await f.answer();
        await f.dispatcher.wake();
        const entry = (await f.f.storage.outbox.forRecord("q-foreground")).find(
          (e) => e.kind === "world.ask.deliver-answer",
        )!;
        const inputs =
          runtime === "core" ? f.world.fake.deliveredInput : f.prompts;
        expect(entry.state).toBe(same ? "delivered" : "refused");
        expect(inputs).toHaveLength(same ? 1 : 0);
        if (!same) {
          expect(entry.evidence?.reason).toBe(RESTART_UNPROVED);
          expect(
            await f.cli.handle(
              { command: "ask get", params: { id: "q-foreground" } },
              null,
            ),
          ).toMatchObject({
            ok: true,
            result: { answer: { text: "printf answer_should_not_run" } },
          });
        }
        // Nothing is replayed later, to either session.
        f.f.time(120_000);
        await f.dispatcher.wake();
        expect(inputs).toHaveLength(same ? 1 : 0);
      });
