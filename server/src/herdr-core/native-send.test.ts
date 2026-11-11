import recording from "./testing/recorded/core-0.1.20-send.json";
import { CoreClient } from "./client";
import { memoryStreamPair } from "./stream";
import { afterEach, expect, test } from "bun:test";
import { CoreOperationFence } from "./fence";
import { coreWorld } from "./testing/core-world";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function setup() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  const address = w.fake.create({
    argv: ["/usr/bin/codex"],
    pid: 52001,
    foreground: {
      pid: 52001,
      name: "codex",
      argv: ["codex"],
      cwd: "/tmp/example",
    },
  });
  await w.settle();
  return {
    w,
    address,
    lease: w.lease(),
    fence: CoreOperationFence.admit(w.lease(), address),
  };
}
test("core answers use native send with a fresh occupant check and no caller", async () => {
  const { w, address, lease, fence } = await setup();
  let marked = false;
  await lease.runtime.send(fence, "An answer", async () => {
    marked = true;
    return true;
  });
  expect(marked).toBe(true);
  const calls = w.fake.calls.filter(
    (c) => c.method === "terminal.get" || c.method === "terminal.send",
  );
  expect(calls.slice(-2)).toEqual([
    { method: "terminal.get", params: { terminal: address } },
    {
      method: "terminal.send",
      params: {
        terminal: address,
        text: "An answer",
        force: false,
        wait: false,
      },
    },
  ]);
});
test("a replacement, changed foreground or retired lease sends nothing", async () => {
  for (const change of ["replacement", "foreground", "lease"] as const) {
    const { w, address, lease, fence } = await setup();
    await expect(
      lease.runtime.send(fence, "An answer", async () => {
        if (change === "replacement")
          w.fake.replaceWithShell(address, { reusePid: true });
        else if (change === "foreground")
          w.fake.foreground(address, {
            pid: 53000,
            name: "sh",
            argv: ["sh"],
            cwd: "/tmp/example",
          });
        else await w.service.disconnect("box");
        if (change !== "lease") await w.settle();
        return true;
      }),
    ).rejects.toThrow();
    expect(w.fake.calls.filter((c) => c.method === "terminal.send")).toEqual(
      [],
    );
  }
});
test("a lost send reply is uncertain and is never retried", async () => {
  const { w, lease, fence } = await setup();
  w.fake.dropNextWriteReply = true;
  await expect(
    lease.runtime.send(fence, "An answer", async () => true, 25),
  ).rejects.toMatchObject({ outcome: "uncertain" });
  expect(w.fake.calls.filter((c) => c.method === "terminal.send")).toHaveLength(
    1,
  );
});

test("recorded release send traffic replays byte-for-byte across split reads", async () => {
  for (const split of [1, 9, 32768]) {
    const [core, world] = memoryStreamPair();
    let hello = true;
    core.onData((bytes) => {
      if (hello) {
        hello = false;
        core.write(
          new TextEncoder().encode(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 0,
              result: {
                generation: 1,
                version: recording.core_version,
                framed: true,
                core: { id: "c0ffee0000000001", name: "example-host" },
                features: ["framed", "events"],
                methods: [
                  "server.status",
                  "terminal.list",
                  "terminal.get",
                  "terminal.read",
                  "events.subscribe",
                  "terminal.send",
                ],
              },
            }) + "\n",
          ),
        );
        return;
      }
      expect(Buffer.from(bytes).toString("base64")).toBe(recording.request);
      const reply = Buffer.from(recording.reply, "base64");
      for (let at = 0; at < reply.length; at += split)
        core.write(reply.subarray(at, at + split));
    });
    const client = await CoreClient.open(world);
    try {
      expect(await client.sendText("t1", "printf example_answer")).toEqual(
        recording.result,
      );
    } finally {
      client.close();
    }
  }
});

test("a core without native send refuses before marking possible input", async () => {
  const w = await coreWorld({ observeOnly: true });
  worlds.push(w);
  await w.connect();
  const address = w.fake.create({
    argv: ["/usr/bin/codex"],
    foreground: { pid: 51001, name: "codex" },
  });
  await w.settle();
  let marked = false;
  await expect(
    w
      .lease()
      .runtime.send(
        CoreOperationFence.admit(w.lease(), address),
        "An answer",
        async () => {
          marked = true;
          return true;
        },
      ),
  ).rejects.toThrow("does not offer terminal.send");
  expect(marked).toBe(false);
  expect(w.fake.calls.filter((c) => c.method === "terminal.send")).toEqual([]);
});
