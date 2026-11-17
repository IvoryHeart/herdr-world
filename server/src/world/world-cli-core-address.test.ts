import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { createWorldCli } from "./world-cli";
import type { CoreCallerSource } from "./world-cli-actor";
import { WorldLedger } from "./world-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(core?: CoreCallerSource) {
  const root = mkdtempSync(join(tmpdir(), "world-core-address-"));
  roots.push(root);
  const ledger = new WorldLedger(join(root, "ledger.json"), { persist: false });
  const cli = createWorldCli({
    ledger,
    board: new BoardStore(join(root, "board.json")),
    hosts: () => [],
    core: () => core ?? null,
    defaultConnectionId: () => null,
    snapshot: async () => ({ revision: 1, observed_at: 1, connections: [] }),
    publishBoard() {},
    publishLedger() {},
  });
  const run = (address: string, command = "whoami") =>
    cli.handle(
      {
        command,
        params: command === "ask" ? { question: "Which branch?" } : {},
        caller: { core_terminal: address },
      },
      () => [
        { pid: 900, ppid: 100, pgrp: 900 },
        { pid: 100, ppid: 1, pgrp: 100 },
      ],
    );
  return { ledger, run };
}

// From herdr-core v0.1.20 terminals.rs address()/parse_id() round-trip tests:
// the counter crosses t19 -> t1b at terminal 20, not t19 -> t20.
test.each(["t19", "t1b", "t1z", "t9z", "t100", "t65jk"])(
  "core CLI accepts %s without a configured core and saves an unverified ask",
  async (address) => {
    const { run, ledger } = fixture();
    const actor = {
      label: `unverified herdr-core ${address}`,
      verified: false,
    };
    expect(await run(address)).toMatchObject({ ok: true, actor });
    const asked = await run(address, "ask");
    expect(asked).toMatchObject({ ok: true, actor });
    if (!asked.ok) throw new Error("ask was refused");
    expect(ledger.ask((asked.result as { id: string }).id)?.actor).toEqual(
      actor,
    );
  },
);

test("a t1b caller is verified only under its live core program", async () => {
  let current = true;
  const core: CoreCallerSource = {
    has: (id) => id === "core-a",
    hosts: () => [
      {
        connection_id: "core-a",
        generation: 3,
        local: true,
        isCurrent: () => current,
        coreId: () => "example-core",
        occupant: (address) =>
          address === "t1b"
            ? {
                coreId: "example-core",
                pid: 100,
                foregroundPid: 100,
                fingerprint: "original",
              }
            : null,
        describe: async () => ({ agent: "codex" }),
      },
    ],
  };
  const { run } = fixture(core);
  expect(await run("t1b", "ask")).toMatchObject({
    ok: true,
    actor: { verified: true, connection_id: "core-a", terminal_id: "t1b" },
  });
  expect(await run("t1c")).toMatchObject({
    ok: true,
    actor: { verified: false },
  });
  current = false;
  expect(await run("t1b")).toMatchObject({
    ok: true,
    actor: { verified: false },
  });
});

test.each([
  "t0",
  "t01",
  "tb",
  "t1a",
  "t1l",
  "T1",
  "t1B",
  "t1b\nfake",
  "t1" + "z".repeat(10),
])("core CLI refuses malformed or oversized address %s", async (address) => {
  expect(await fixture().run(address)).toMatchObject({
    ok: false,
    code: "usage",
  });
});
