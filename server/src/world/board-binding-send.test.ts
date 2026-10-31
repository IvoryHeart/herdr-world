import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger } from "../storage/world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import { qualifyBoardSend } from "./board-binding-send";

test("saved Board sends require an exact unambiguous current listing on the original source", async () => {
  const root = mkdtempSync(join(tmpdir(), "binding-send-"));
  const store = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "legacy.json") },
    { clock: systemClock, scheduler: systemScheduler },
  );
  const session = {
    source: "synthetic",
    agent: "fixture",
    kind: "id",
    value: "session-a",
  };
  const pane = {
    pane_id: "pane-a",
    terminal_id: "terminal-a",
    agent_session: session,
  };
  const fence = {
    adapter: "herdr",
    instance: "studio",
    service_incarnation: "service-a",
    generation: 1,
  };
  let current = true;
  let rows = [pane];
  let retireDuringRead = false;
  const request = {
    record_id: "legacy-string",
    slot: "to",
    pane_id: "pane-a",
    terminal_id: "terminal-a",
    fence,
    isCurrent: () => current,
    async call(method: string) {
      expect(method).toBe("pane.list");
      if (retireDuringRead) current = false;
      return { panes: rows };
    },
  };
  try {
    await store.bindings.create({
      record_id: request.record_id,
      slot: "to",
      policy: "board-string",
      adapter: "herdr",
      instance: "studio",
      kind: "pane",
      native_id: "pane-a",
      evidence: { terminals: ["terminal-a"] },
    });
    expect(await qualifyBoardSend(store.bindings, request)).toBe(true);
    rows = [pane, { ...pane, pane_id: "pane-b" }];
    expect(await qualifyBoardSend(store.bindings, request)).toBe(false);
    rows = [pane, { ...pane, pane_id: "pane-b", terminal_id: "terminal-b" }];
    expect(await qualifyBoardSend(store.bindings, request)).toBe(false); // Duplicate session, even across distinct terminals.
    rows = [{ ...pane, terminal_id: "terminal-b" }];
    expect(await qualifyBoardSend(store.bindings, request)).toBe(false);
    rows = [pane];
    expect(
      await qualifyBoardSend(store.bindings, {
        ...request,
        fence: { ...fence, instance: "other-studio" },
      }),
    ).toBe(false);
    retireDuringRead = true;
    expect(await qualifyBoardSend(store.bindings, request)).toBe(false);
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
