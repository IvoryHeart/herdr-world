import { afterEach, describe, expect, test } from "bun:test";
import { deliverCore, type CoreDeliveryInput } from "./delivery";
import { CoreOperationFence } from "./fence";
import { coreHarnessNames } from "./harness";
import { coreRecipientToken } from "./recipient";
import { coreWorld, until } from "./testing/core-world";

/**
 * Chat messages, answers and answer keys to agents on herdr-core (M4/M5,
 * design §8), through the real provider against an in-process core that
 * holds and types sends as core 0.1.20 does (input.rs; measured live in
 * delivery.live.test.ts). Every assertion about what reached a program
 * reads what the core typed and into which program, not World's intent.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function world() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  return w;
}

/** An agent as core records one World started (absolute executable). */
function agent(w: World, kind = "claude", status = "idle") {
  const pid = 70_000 + w.fake.currentSeq;
  const program = `/opt/example/bin/${kind}`;
  const address = w.fake.create({
    argv: [program],
    pid,
    keep: true,
    reported: true,
    status: { state: status, app: kind },
    foreground: { pid, name: kind, argv: [program], cwd: "/tmp/example" },
  });
  return address;
}

/** The recipient token the browser holds: the read model's, not a recompute. */
async function recipientOf(w: World, address: string): Promise<string> {
  await w.settle();
  const { panes } = await w.rows();
  const pane = panes.find((p) => p.pane_id === address);
  const token = pane?.core_recipient;
  if (typeof token !== "string") throw new Error(`no recipient for ${address}`);
  return token;
}

const sends = (w: World) =>
  w.fake.calls.filter(
    (c) => c.method === "terminal.send" || c.method === "terminal.keys",
  );
const message = (text: string): CoreDeliveryInput => ({
  kind: "message",
  text,
});

describe("one message reaches the agent once", () => {
  test("core's own send, with only the native parameters World means", async () => {
    const w = await world();
    const t = agent(w);
    const outcome = await deliverCore(
      w.lease(),
      t,
      await recipientOf(w, t),
      message("Check the tests"),
    );
    expect(outcome).toEqual({ status: "sent", turn: 0, started: false });
    const [call] = sends(w);
    // No caller (it would tag the message and parent nothing), no wait, no
    // condition: core's quiet and draft rules apply as to any client.
    expect(call).toEqual({
      method: "terminal.send",
      params: { terminal: t, text: "Check the tests", force: false },
    });
    expect(w.fake.deliveredInput).toEqual([
      expect.objectContaining({
        address: t,
        input: "Check the tests",
        foreground: "claude",
      }),
    ]);
  });

  test("every harness World recognises takes the same path", async () => {
    const w = await world();
    const names = coreHarnessNames();
    // Herdr's integrations and the desktop app's agents, at least.
    expect(names).toEqual(
      expect.arrayContaining(["claude", "codex", "opencode", "gemini", "pi"]),
    );
    for (const kind of names) {
      const t = agent(w, kind);
      const outcome = await deliverCore(
        w.lease(),
        t,
        await recipientOf(w, t),
        message(`hello ${kind}`),
      );
      expect(outcome.status).toBe("sent");
    }
    // One send per harness, all alike: no harness-specific channel.
    const calls = sends(w);
    expect(calls).toHaveLength(names.length);
    for (const call of calls)
      expect(Object.keys(call.params as object).sort()).toEqual([
        "force",
        "terminal",
        "text",
      ]);
    expect(w.fake.deliveredInput.map((t) => t.foreground)).toEqual(names);
  });

  test("a program that reports status but no list names is reachable too", async () => {
    const w = await world();
    const t = w.fake.create({
      argv: ["/opt/example/bin/helper"],
      reported: true,
      status: { state: "idle", app: "helper" },
      foreground: { pid: 1234, name: "helper", argv: ["helper"], cwd: "/" },
    });
    expect(
      await deliverCore(w.lease(), t, await recipientOf(w, t), message("hi")),
    ).toMatchObject({ status: "sent" });
  });
});

describe("World sends only to the program the person addressed", () => {
  test("the fresh native read refuses a replacement not yet in the mirror", async () => {
    const w = await world();
    const t = agent(w);
    const token = await recipientOf(w, t);
    // The source changed before its event reached World; no event is emitted.
    Object.assign(w.fake.terminal(t)!, {
      argv: ["/bin/sh"],
      reported: false,
      status: null,
      foreground: { pid: 999, name: "sh", argv: ["sh"] },
    });
    expect(
      await deliverCore(w.lease(), t, token, message("do not type")),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(sends(w)).toEqual([]);
    expect(w.fake.deliveredInput).toEqual([]);
  });
  test("a durable answer revoked during preparation sends nothing", async () => {
    const w = await world();
    const t = agent(w);
    const token = await recipientOf(w, t);
    expect(
      await deliverCore(w.lease(), t, token, message("saved answer"), {
        beforeSubmit: async () => false,
      }),
    ).toMatchObject({ status: "refused" });
    expect(w.fake.deliveredInput).toEqual([]);
    expect(sends(w)).toEqual([]);
  });
  test("missing foreground evidence refuses instead of trusting a shell wrapper", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.foreground(t, null);
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, message("x")),
    ).toMatchObject({ status: "refused" });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("loss and recovery of reporting retires an old session binding", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.lease().runtime.layoutChanged();
    const published = w.changes.length;
    const record = w.fake.terminal(t)!;
    record.reported = false;
    w.fake.status(t, null);
    await w.settle();
    w.fake.report(t, { state: "idle", app: "claude" });
    await w.settle();
    await until(() => w.changes.length > published);
    expect(
      await deliverCore(w.lease(), t, recipient, message("x")),
    ).toMatchObject({ status: "refused" });
    expect(w.fake.deliveredInput).toEqual([]);
    const fresh = await recipientOf(w, t);
    expect(fresh).not.toBe(recipient);
    expect(
      await deliverCore(w.lease(), t, fresh, message("new session")),
    ).toMatchObject({ status: "sent" });
  });

  test("even a freshly forged shell token cannot admit agent sends", async () => {
    const w = await world();
    const t = w.fake.create({ argv: ["/bin/sh"] });
    await w.settle();
    const v = w.lease().runtime.core;
    const token = coreRecipientToken(
      v.epoch!.coreId,
      v.terminal(t),
      v.occupancy(t),
    )!;
    expect(await deliverCore(w.lease(), t, token, message("x"))).toMatchObject({
      status: "refused",
      reason: "unsupported",
    });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("a kept replacement shell is refused; nothing is typed into it", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.replaceWithShell(t);
    await w.settle();
    const outcome = await deliverCore(
      w.lease(),
      t,
      recipient,
      message("rm -rf build"),
    );
    expect(outcome).toEqual({
      status: "refused",
      reason: "changed",
      message:
        "It is no longer the agent you saw: sh runs there now. Nothing was sent.",
    });
    expect(sends(w)).toEqual([]);
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("a replacement that reuses the pid is refused", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.replaceWithShell(t, { reusePid: true });
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, message("x")),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(sends(w)).toEqual([]);
  });

  test("an agent that exits to the shell wrapping it is refused", async () => {
    // Started as `zsh -ic … claude`: the argv and pid stay the shell's;
    // only the foreground tells the agent is gone.
    const w = await world();
    const t = w.fake.create({
      argv: ["/bin/zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "claude"],
      pid: 4242,
      reported: true,
      status: { state: "idle", app: "claude" },
      foreground: { pid: 4300, name: "claude", argv: ["claude"], cwd: "/" },
    });
    const recipient = await recipientOf(w, t);
    w.fake.foreground(t, { pid: 4242, name: "zsh", argv: ["zsh"], cwd: "/" });
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, message("ls")),
    ).toMatchObject({
      status: "refused",
      reason: "changed",
      message: expect.stringContaining("zsh runs there now"),
    });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("a missing foreground at binding or dispatch is not sufficient evidence", async () => {
    const w = await world();
    const t = agent(w);
    const bound = await recipientOf(w, t);
    w.fake.foreground(t, null);
    await w.settle();
    const missing = await recipientOf(w, t);
    for (const token of [bound, missing])
      expect(
        await deliverCore(w.lease(), t, token, message("x")),
      ).toMatchObject({ status: "refused" });
    expect(sends(w)).toEqual([]);
  });

  test("an ended agent is refused", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.finish(t);
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, message("x")),
    ).toMatchObject({ status: "refused", reason: "ended" });
    expect(sends(w)).toEqual([]);
  });

  test("a token for another terminal or core never matches", async () => {
    const w = await world();
    const a = agent(w);
    const b = agent(w);
    const forA = await recipientOf(w, a);
    expect(await deliverCore(w.lease(), b, forA, message("x"))).toMatchObject({
      status: "refused",
      reason: "changed",
    });
    const record = w.lease().runtime.core.terminal(a)!;
    expect(coreRecipientToken("another-core", record)).not.toBe(forA);
    expect(sends(w)).toEqual([]);
  });

  test("a retired lease sends nothing", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    const lease = w.lease();
    await w.service.disconnect("box");
    expect(await deliverCore(lease, t, recipient, message("x"))).toMatchObject({
      status: "refused",
      reason: "unavailable",
    });
    expect(sends(w)).toEqual([]);
  });
});

describe("while core holds a send for a person typing there", () => {
  test("a replacement makes World cancel it; core types nothing", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.holdSends = true;
    const pending = deliverCore(w.lease(), t, recipient, message("make test"));
    await until(() => w.fake.heldSendCount === 1);
    w.fake.replaceWithShell(t);
    const outcome = await pending;
    expect(outcome).toEqual({
      status: "refused",
      reason: "changed",
      // World cancels on core's first sign (the loss); by the reply the
      // replacement shell is there.
      message:
        "It is no longer the agent you saw: sh runs there now. World cancelled the input while herdr-core held it. Nothing was typed.",
    });
    expect(w.fake.calls.map((c) => c.method)).toContain("$/cancelRequest");
    w.fake.releaseSends();
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("control: without World's cancel, core types it into the shell (Q3)", async () => {
    const w = await world();
    const t = agent(w);
    w.fake.holdSends = true;
    // The same send through the runtime, with nobody watching the occupant.
    await w.settle();
    const lease = w.lease();
    const fence = CoreOperationFence.admit(lease, t);
    const never = new AbortController();
    const pending = lease.runtime.send(
      fence,
      { text: "make test", force: false },
      { cancel: never.signal },
    );
    await until(() => w.fake.heldSendCount === 1);
    w.fake.replaceWithShell(t);
    await w.settle();
    w.fake.releaseSends();
    await pending;
    expect(w.fake.deliveredInput).toEqual([
      expect.objectContaining({ input: "make test", foreground: "sh" }),
    ]);
  });

  test("input typed just before a replacement is reported uncertain", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    // Core typed it, then the program was replaced before its reply.
    w.fake.onTyped = () => w.fake.replaceWithShell(t);
    expect(await deliverCore(w.lease(), t, recipient, message("x"))).toEqual({
      status: "uncertain",
      message:
        "It changed while herdr-core was delivering: the input may have reached what replaced it. World will not send it again.",
    });
    expect(sends(w)).toHaveLength(1);
  });

  test("no reply in time is uncertain, cancelled at core and never retried", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.holdSends = true;
    const outcome = await deliverCore(w.lease(), t, recipient, message("x"), {
      timeoutMs: 50,
    });
    expect(outcome).toMatchObject({ status: "uncertain" });
    await until(() => w.fake.heldSendCount === 0);
    expect(w.fake.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["terminal.send", "$/cancelRequest"]),
    );
    expect(sends(w)).toHaveLength(1);
    w.fake.releaseSends();
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("kill -9 of core while it holds the send: uncertain, nothing typed", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.holdSends = true;
    const pending = deliverCore(w.lease(), t, recipient, message("x"));
    await until(() => w.fake.heldSendCount === 1);
    w.fake.kill(w.socket);
    expect(await pending).toMatchObject({ status: "uncertain" });
    // Core drops the sends of a connection that closed.
    expect(w.fake.heldSendCount).toBe(0);
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("a lost reply is uncertain and sent only once", async () => {
    const w = await world();
    const t = agent(w);
    const recipient = await recipientOf(w, t);
    w.fake.dropNextWriteReply = true;
    expect(
      await deliverCore(w.lease(), t, recipient, message("x"), {
        timeoutMs: 50,
      }),
    ).toMatchObject({ status: "uncertain" });
    expect(sends(w)).toHaveLength(1);
  });
});

describe("answers to a waiting agent", () => {
  test("a typed answer is forced into its dialog only while it waits", async () => {
    const w = await world();
    const t = agent(w, "claude", "blocked");
    const recipient = await recipientOf(w, t);
    expect(
      await deliverCore(w.lease(), t, recipient, {
        kind: "answer",
        text: "main",
      }),
    ).toMatchObject({ status: "sent" });
    expect(sends(w)[0]!.params).toEqual({
      terminal: t,
      text: "main",
      force: true,
    });
    w.fake.status(t, "working");
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, {
        kind: "answer",
        text: "again",
      }),
    ).toEqual({
      status: "refused",
      reason: "not-waiting",
      message: "It is no longer waiting on a question. Nothing was sent.",
    });
    expect(sends(w)).toHaveLength(1);
  });

  test("a message to a waiting agent is core's refusal: nothing typed", async () => {
    const w = await world();
    const t = agent(w, "codex", "blocked");
    expect(
      await deliverCore(w.lease(), t, await recipientOf(w, t), message("hi")),
    ).toMatchObject({ status: "refused", reason: "waiting" });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("an option is pressed with core's keys, encoded by core", async () => {
    const w = await world();
    const t = agent(w, "opencode", "blocked");
    expect(
      await deliverCore(w.lease(), t, await recipientOf(w, t), {
        kind: "keys",
        keys: ["2"],
      }),
    ).toMatchObject({ status: "sent" });
    expect(sends(w)).toEqual([
      { method: "terminal.keys", params: { terminal: t, keys: ["2"] } },
    ]);
  });

  test("keys that control rather than answer are refused before core", async () => {
    const w = await world();
    const t = agent(w, "claude", "blocked");
    const recipient = await recipientOf(w, t);
    for (const keys of [["ctrl+c"], [], Array(9).fill("1"), ["alt+x"]])
      expect(
        await deliverCore(w.lease(), t, recipient, { kind: "keys", keys }),
      ).toMatchObject({ status: "refused", reason: "invalid" });
    expect(sends(w)).toEqual([]);
  });

  test("an answer to a replaced agent is refused like a message", async () => {
    const w = await world();
    const t = agent(w, "claude", "blocked");
    const recipient = await recipientOf(w, t);
    w.fake.replaceWithShell(t);
    await w.settle();
    expect(
      await deliverCore(w.lease(), t, recipient, { kind: "keys", keys: ["1"] }),
    ).toMatchObject({ status: "refused", reason: "changed" });
    expect(sends(w)).toEqual([]);
  });
});
