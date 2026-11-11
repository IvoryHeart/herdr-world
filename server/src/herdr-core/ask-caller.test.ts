import { createAnswerRecorder } from "../world/answer-record";
import { createAnswerDispatcher } from "../world/answer-dispatch";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../world/board-store";
import { createAskRecipients } from "../world/ask-recipient";
import {
  ANSWER_DELIVERY_VERB,
  isAnswerIntent,
  originalAsker,
  sameRecipient,
  validRecipient,
  type CoreAnswerRecipient,
} from "../world/ask-delivery-types";
import type { CallerProcess } from "../world/caller-identity";
import {
  identifyCaller,
  type CliHost,
  type CoreCallerSource,
} from "../world/world-cli-actor";
import { createWorldCliService } from "../world/world-cli-service";
import { productionAnswerFixture } from "../world/testing/answer-delivery-fixture";
import { coreCallerSource, coreOccupantFingerprint } from "./ask-caller";
import { coreWorld, until } from "./testing/core-world";

/**
 * Asks from herdr-core agents (P4, M5): a caller inside a core terminal is
 * verified only when it runs under that terminal's program on a local core,
 * and its ask is bound to that program, never to a replacement at the same
 * address, another core's same address or a retired runtime.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function world(id = "box") {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect(id);
  return w;
}

/** The agent CLI's view of these cores; `remote` ones run over SSH. */
function source(
  entries: Array<{ w: World; id: string; remote?: boolean }>,
): CoreCallerSource {
  const sources = entries.map(({ w, id, remote }) =>
    coreCallerSource(() => ({
      manager: {
        has: (value: string) => value === id && w.core.manager.has(id),
        list: () => (w.core.manager.has(id) ? [{ id }] : []),
        readyRuntimeLease: (value: string) =>
          value === id ? w.core.manager.readyRuntimeLease(id) : null,
      },
      host: () => (remote ? { destination: "dev@example.test" } : {}),
    })),
  );
  return {
    has: (id) => sources.some((s) => s.has(id)),
    hosts: () => sources.flatMap((s) => s.hosts()),
  };
}

/** A caller process chain: the CLI, then its ancestors (nearest first). */
const chainOf = (...pids: number[]): CallerProcess[] =>
  pids.map((pid, index) => ({
    pid,
    ppid: pids[index + 1] ?? 1,
    pgrp: pid,
  }));
/** A locator that finds the caller only under the given roots. */
const locator =
  (chain: CallerProcess[]) =>
  (roots: readonly number[]): CallerProcess[] | null =>
    chain.some((entry) => roots.includes(entry.pid)) ? chain : null;

const agentFields = (pid: number) => ({
  argv: ["/opt/example/bin/claude"],
  pid,
  foreground: {
    pid,
    name: "claude",
    argv: ["/opt/example/bin/claude"],
    cwd: "/tmp/example",
  },
});

async function agent(w: World, pid: number, id = "box") {
  const address = w.fake.create(agentFields(pid));
  w.fake.report(address, { state: "working", app: "claude-code" });
  await until(
    () =>
      w.lease(id).runtime.core.mirror.cursor === w.fake.currentSeq &&
      w.lease(id).runtime.core.terminal(address)?.pid === pid,
  );
  return address;
}

const NO_TUI: CliHost[] = [];

describe("a caller inside a herdr-core terminal (§4.10)", () => {
  test("is verified when it runs under the terminal's program", async () => {
    const w = await world();
    const address = await agent(w, 41_001);
    const { actor } = await identifyCaller(
      NO_TUI,
      undefined,
      locator(chainOf(99_001, 41_001, 1_000)),
      { terminal: address, source: source([{ w, id: "box" }]) },
    );
    const record = w.lease().runtime.core.terminal(address)!;
    expect(actor).toMatchObject({
      label: `claude in ${address}`,
      verified: true,
      connection_id: "box",
      connection_generation: w.lease().generation,
      pane_id: address,
      terminal_id: address,
      agent: "claude",
      agent_session_fingerprint: coreOccupantFingerprint(
        w.lease().runtime.core.epoch!.coreId,
        record,
      ),
    });
    expect(actor.workspace_id).toBeString();
  });

  test("a claim it does not run under, or that cannot be checked, stays unverified", async () => {
    const w = await world();
    const address = await agent(w, 41_002);
    const cores = source([{ w, id: "box" }]);
    // Not under the program.
    expect(
      (
        await identifyCaller(NO_TUI, undefined, locator(chainOf(99_002, 7)), {
          terminal: address,
          source: cores,
        })
      ).actor,
    ).toEqual({ label: `unverified herdr-core ${address}`, verified: false });
    // Off Linux there is no locator.
    expect(
      (
        await identifyCaller(NO_TUI, undefined, null, {
          terminal: address,
          source: cores,
        })
      ).actor.verified,
    ).toBe(false);
    // A foreground process alone is not the terminal's program.
    w.fake.foreground(address, {
      pid: 41_099,
      name: "claude",
      argv: ["claude"],
      cwd: "/tmp/example",
    });
    await w.settle();
    expect(
      (
        await identifyCaller(
          NO_TUI,
          undefined,
          locator(chainOf(99_002, 41_099)),
          { terminal: address, source: cores },
        )
      ).actor.verified,
    ).toBe(false);
    // A core over SSH: its processes are not this machine's.
    expect(
      (
        await identifyCaller(
          NO_TUI,
          undefined,
          locator(chainOf(99_002, 41_002)),
          {
            terminal: address,
            source: source([{ w, id: "box", remote: true }]),
          },
        )
      ).actor.verified,
    ).toBe(false);
  });

  test("colliding addresses: only the core whose program is the ancestor matches", async () => {
    const a = await world("core-a");
    const b = await world("core-b");
    const onA = await agent(a, 42_001, "core-a");
    const onB = await agent(b, 42_002, "core-b");
    expect(onA).toBe(onB); // every core has its own t1
    const cores = source([
      { w: a, id: "core-a" },
      { w: b, id: "core-b" },
    ]);
    const viaB = await identifyCaller(
      NO_TUI,
      undefined,
      locator(chainOf(99_003, 42_002)),
      { terminal: onB, source: cores },
    );
    expect(viaB.actor).toMatchObject({
      verified: true,
      connection_id: "core-b",
    });
    // Nested cores: the nearer program wins.
    const nested = await identifyCaller(
      NO_TUI,
      undefined,
      locator(chainOf(99_003, 42_001, 42_002)),
      { terminal: onA, source: cores },
    );
    expect(nested.actor).toMatchObject({
      verified: true,
      connection_id: "core-a",
    });
  });

  test("an equally near match on two cores is ambiguous and unverified", async () => {
    const a = await world("core-a");
    const b = await world("core-b");
    const address = await agent(a, 43_001, "core-a");
    await agent(b, 43_001, "core-b");
    const { actor } = await identifyCaller(
      NO_TUI,
      undefined,
      locator(chainOf(99_004, 43_001)),
      {
        terminal: address,
        source: source([
          { w: a, id: "core-a" },
          { w: b, id: "core-b" },
        ]),
      },
    );
    expect(actor.verified).toBe(false);
  });

  test("with both runtimes' markers, the nearest terminal decides", async () => {
    const w = await world();
    const address = await agent(w, 44_001);
    const tui = (shell: number): CliHost => ({
      connection_id: "studio",
      generation: 3,
      local: true,
      call: async (method, params) => {
        if (method === "pane.process_info")
          return { process_info: { shell_pid: shell } };
        if (method === "pane.get")
          return {
            pane: {
              pane_id: params.pane_id,
              terminal_id: "term-1",
              agent: "codex",
            },
          };
        return null;
      },
    });
    const cores = source([{ w, id: "box" }]);
    // A core started inside a TUI pane: the core terminal is nearer.
    const inCore = await identifyCaller(
      [tui(77_001)],
      "w1:p1",
      locator(chainOf(99_005, 44_001, 77_001)),
      { terminal: address, source: cores },
    );
    expect(inCore.actor).toMatchObject({
      verified: true,
      connection_id: "box",
    });
    expect(inCore.host).toBeUndefined();
    // A TUI started inside a core terminal: the pane is nearer.
    const inPane = await identifyCaller(
      [tui(77_002)],
      "w1:p1",
      locator(chainOf(99_005, 77_002, 44_001)),
      { terminal: address, source: cores },
    );
    expect(inPane.actor).toMatchObject({
      verified: true,
      connection_id: "studio",
      pane_id: "w1:p1",
    });
  });
});

describe("a core asker's recipient (M5)", () => {
  const recipientsFor = (cores: CoreCallerSource) =>
    createAskRecipients({
      connections: () => ({ list: () => [], readyRuntimeLease: () => null }),
      clock: { now: () => 1_000, monotonic: () => 1_000 },
      incarnation: "run-1",
      core: () => cores,
    });
  async function asker(w: World, pid: number) {
    const address = await agent(w, pid);
    const cores = source([{ w, id: "box" }]);
    const { actor } = await identifyCaller(
      NO_TUI,
      undefined,
      locator(chainOf(99_100, pid)),
      { terminal: address, source: cores },
    );
    return { address, cores, actor, recipients: recipientsFor(cores) };
  }

  test("is bound to the program and attaches to core delivery", async () => {
    const w = await world();
    const { address, actor, recipients } = await asker(w, 45_001);
    const recipient = (await recipients.capture(actor)) as CoreAnswerRecipient;
    expect(recipient).toMatchObject({
      adapter: "herdr-core",
      connection_id: "box",
      pane_id: address,
      terminal_id: address,
      core_id: w.lease().runtime.core.epoch!.coreId,
      pid: 45_001,
      reported: { scheme: "herdr-core-occupant-v1" },
      service_incarnation: "run-1",
      connection_generation: w.lease().generation,
    });
    expect(validRecipient(recipient)).toBe(true);
    expect(originalAsker(recipient, actor)).toBe(true);
    expect(sameRecipient(recipient, { ...recipient })).toBe(true);
    expect(await recipients.resolve(recipient)).toMatchObject({
      state: "attached",
      kind: "core",
    });
    expect(recipients.fence(recipient)).toEqual({
      connection_id: "box",
      generation: w.lease().generation,
      service_incarnation: "run-1",
    });
    // Never handed to the Chat sender.
    expect(
      recipients.guard(recipient, w.lease() as never, {
        pane_id: address,
        terminal_id: address,
      }),
    ).toBe(false);
    // Durable intents admit exactly this shape.
    const intent = {
      verb: ANSWER_DELIVERY_VERB.name,
      version: 1,
      origin: "world.ask.answer",
      params: { ask_id: "q1", answer_occurrence: "a1" },
      actor: { kind: "owner" },
      condition: { awaiting_delivery: true, recipient },
    };
    expect(isAnswerIntent(intent)).toBe(true);
    expect(
      isAnswerIntent({
        ...intent,
        condition: {
          awaiting_delivery: true,
          recipient: { ...recipient, conversation: { scheme: "x" } },
        },
      }),
    ).toBe(false);
  });

  test("saved core answers dispatch durably, and an EOF after send stays uncertain", async () => {
    for (const lost of [false, true]) {
      const w = await world();
      const { actor, address, cores } = await asker(w, 51001);
      const f = await productionAnswerFixture(join(w.root, "answer-store"));
      const recipients = createAskRecipients({
        connections: () => ({ list: () => [], readyRuntimeLease: () => null }),
        clock: f.clock,
        incarnation: f.storage.incarnation,
        core: () => cores,
      });
      const recipient = await recipients.capture(actor);
      await f.storage.ledger.update((doc) =>
        doc.asks.push({
          id: "q-core",
          at: 1000,
          actor,
          recipient,
          question: "Proceed?",
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
        incarnation: f.storage.incarnation,
        recipients,
        clock: f.clock,
        scheduler: f.scheduler,
        changed() {},
        log() {},
      });
      try {
        await record("q-core", "The stored core answer", { kind: "owner" });
        if (lost) w.fake.dropNextWriteReply = true;
        f.time(4000);
        const sending = dispatcher.wake();
        if (lost) {
          await until(() =>
            w.fake.calls.some((c) => c.method === "terminal.send"),
          );
          w.fake.kill(w.socket);
        }
        await sending;
        const entry = (await f.storage.outbox.forRecord("q-core")).find(
          (e) => e.kind === ANSWER_DELIVERY_VERB.name,
        )!;
        expect(entry.state).toBe(lost ? "uncertain" : "delivered");
        expect(
          w.fake.calls.filter((c) => c.method === "terminal.send"),
        ).toEqual([
          {
            method: "terminal.send",
            params: {
              terminal: address,
              text: "Answer to q-core:\nQuestion: Proceed?\nAnswer from owner: The stored core answer",
              force: false,
              wait: false,
            },
          },
        ]);
        f.time(60000);
        await dispatcher.wake();
        expect(
          w.fake.calls.filter((c) => c.method === "terminal.send"),
        ).toHaveLength(1);
      } finally {
        await dispatcher.stop();
        await f.stop();
      }
    }
  });

  test("a replacement shell at the address is another asker, even with the same pid", async () => {
    for (const reusePid of [false, true]) {
      const w = await world();
      const { address, actor, recipients } = await asker(w, 46_001);
      const recipient = (await recipients.capture(actor))!;
      w.fake.replaceWithShell(address, { reusePid });
      await w.settle();
      expect(await recipients.resolve(recipient)).toEqual({
        state: "unconfirmed",
        reason: "The asking program changed; answer not sent, use ask get",
      });
      // The replacement cannot speak as the asker either.
      expect(
        await recipients.authorize(
          { kind: "agent", actor: { ...actor, label: "x" } },
          { recipient, owner_only: false } as never,
        ),
      ).toBe("refused");
      await w.dispose();
      worlds.splice(worlds.indexOf(w), 1);
    }
  });

  test("an ended terminal, a removed connection and a different core end it", async () => {
    const w = await world();
    const { address, actor, recipients, cores } = await asker(w, 47_001);
    const recipient = (await recipients.capture(actor)) as CoreAnswerRecipient;
    expect(
      await recipients.resolve({ ...recipient, core_id: "another-core" }),
    ).toMatchObject({ state: "ended" });
    expect(
      await recipientsFor({ has: () => false, hosts: () => [] }).resolve(
        recipient,
      ),
    ).toMatchObject({ state: "ended" });
    expect(
      await recipientsFor(cores).resolve({
        ...recipient,
        service_incarnation: "run-0",
      }),
    ).toMatchObject({ state: "unconfirmed" });
    w.fake.finish(address);
    await w.settle();
    expect(await recipients.resolve(recipient)).toEqual({
      state: "ended",
      reason: "The original terminal ended; use ask get",
    });
  });

  test("a retired runtime captures nothing and resolves as offline", async () => {
    const w = await world();
    const { actor, recipients } = await asker(w, 48_001);
    const recipient = (await recipients.capture(actor))!;
    // An actor from another generation is never bound.
    expect(
      await recipients.capture({
        ...actor,
        connection_generation: actor.connection_generation! + 1,
      }),
    ).toBeUndefined();
    w.fake.kill(w.socket);
    await until(() => !w.core.manager.readyRuntimeLease("box")?.isCurrent());
    expect(await recipients.resolve(recipient)).toMatchObject({
      state: "unresolved",
    });
    expect(await recipients.capture(actor)).toBeUndefined();
    expect(recipients.fence(recipient)).toBeUndefined();
  });

  test("another verified core agent may answer; the asker may not", async () => {
    const w = await world();
    const { actor, recipients, cores } = await asker(w, 49_001);
    const recipient = (await recipients.capture(actor))!;
    const peerAddress = await agent(w, 49_002);
    const peer = (
      await identifyCaller(
        NO_TUI,
        undefined,
        locator(chainOf(99_200, 49_002)),
        {
          terminal: peerAddress,
          source: cores,
        },
      )
    ).actor;
    const ask = { recipient, owner_only: false } as never;
    expect(
      await recipients.authorize({ kind: "agent", actor: peer }, ask),
    ).toBe("allowed");
    expect(await recipients.authorize({ kind: "agent", actor }, ask)).toBe(
      "refused",
    );
    expect(
      await recipients.authorize({ kind: "agent", actor: peer }, {
        ...(ask as object),
        owner_only: true,
      } as never),
    ).toBe("refused");
  });
});

// The real endpoint: a child process of this test calls the agent CLI over
// loopback; the core terminal's program is this test process, so the
// service finds the caller under it in /proc, as for a real core agent.
test.skipIf(process.platform !== "linux")(
  "the agent CLI records a core agent's ask as its verified, bound question",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "core-ask-"));
    const w = await world();
    const address = await agent(w, process.pid);
    const f = await productionAnswerFixture(join(root, "answers"));
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
        list: () => [],
        defaultId: () => null,
        readyRuntimeLease: () => null,
      }),
      core: () => source([{ w, id: "box" }]),
      snapshots: () => null,
      townMoveQueues: new Map(),
      publishBoard: () => {},
      broadcast: () => {},
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) =>
        service.http(
          request,
          server.requestIP(request),
          server.port!,
          () => true,
        ),
    });
    const command = async (
      command: string,
      params: Record<string, unknown>,
      caller: Record<string, unknown>,
    ) => {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          "const response = await fetch(process.argv[1], { method: 'POST', body: process.argv[2] }); console.log(await response.text());",
          `http://127.0.0.1:${server.port}/api/world/cli`,
          JSON.stringify({ command, params, caller }),
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
      const asked = await command(
        "ask",
        { question: "Which branch?", key: "branch" },
        { core_terminal: address },
      );
      expect(asked.actor).toMatchObject({
        verified: true,
        connection_id: "box",
        pane_id: address,
        terminal_id: address,
      });
      const ask = f.storage.ledger.ask(asked.result.id)!;
      expect(ask.actor.connection_id).toBe("box");
      expect(ask.recipient).toMatchObject({
        adapter: "herdr-core",
        pane_id: address,
        pid: process.pid,
      });
      // Cause keys and withdrawal need the verified asker: they work.
      expect(
        await command(
          "ask withdraw",
          { key: "branch" },
          {
            core_terminal: address,
          },
        ),
      ).toMatchObject({ ok: true });
      // A bad claim is a usage error; a claim on no such terminal is unverified.
      expect(
        await command("whoami", {}, { core_terminal: "w1:p1" }),
      ).toMatchObject({ ok: false, code: "usage" });
      expect(
        (await command("whoami", {}, { core_terminal: "t999" })).actor,
      ).toEqual({ label: "unverified herdr-core t999", verified: false });
    } finally {
      await service.stop();
      await server.stop(true);
      await f.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
