import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleBoardTownRpc } from "./board-town";
import type { ConnectionRpcContext } from "./context";
import { openWorldLedger } from "../storage/world-storage";
import { BoardStore } from "../world/board-store";
import { systemClock, systemScheduler } from "../service/ports";

test("the actual Board RPC refuses duplicate bindings and notes edited during qualification before prompt dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "board-binding-rpc-"));
  const store = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    { clock: systemClock, scheduler: systemScheduler },
  );
  const board = new BoardStore(join(root, "board.json"));
  try {
    board.patch([
      {
        op: "note.put",
        note: {
          id: "note-fixture",
          text: "Fixture",
          color: "yellow",
          x: 0,
          y: 0,
        },
      },
      {
        op: "string.put",
        string: {
          id: "string-fixture",
          from: { note: "note-fixture" },
          to: {
            anchor: {
              connection_id: "studio",
              kind: "pane",
              native_id: "pane-a",
              witness: ["terminal-a"],
            },
          },
        },
      },
    ]);
    await store.bindings.create({
      record_id: "string-fixture",
      slot: "to",
      policy: "board-string",
      adapter: "herdr",
      instance: "studio",
      kind: "pane",
      native_id: "pane-a",
      evidence: { terminals: ["terminal-a"] },
    });
    const calls: string[] = [],
      replies: { result: { status: string } }[] = [];
    let mutateDuringListing = false;
    const rpc = {
      id: "request-fixture",
      method: "board.send_note",
      route: { scope: "connection", connectionId: "studio", generation: 1 },
      requestIsCurrent: () => true,
      params: {
        pane_id: "pane-a",
        terminal_id: "terminal-a",
        note_id: "note-fixture",
        string_id: "string-fixture",
        note_rev: board.get().notes[0]!.rev,
      },
      services: {
        board: () => board,
        bindings: store.bindings,
        serviceIncarnation: "service-a",
      },
      connection: {
        herdr: {
          async call(method: string) {
            calls.push(method);
            if (method !== "pane.list")
              throw new Error("Unexpected downstream send");
            if (mutateDuringListing) {
              board.patch([
                {
                  op: "note.put",
                  note: {
                    ...board.get().notes[0]!,
                    text: "Edited during source read",
                  },
                },
              ]);
              return {
                panes: [{ pane_id: "pane-a", terminal_id: "terminal-a" }],
              };
            }
            return {
              panes: [
                { pane_id: "pane-a", terminal_id: "terminal-a" },
                { pane_id: "pane-b", terminal_id: "terminal-a" },
              ],
            };
          },
        },
      },
      sendReply: (reply: (typeof replies)[number]) => {
        replies.push(reply);
        return true;
      },
      sendError: (_name: string, error: unknown) => {
        throw error;
      },
    } as unknown as ConnectionRpcContext;
    await handleBoardTownRpc(rpc);
    expect(calls).toEqual(["pane.list"]);
    expect(replies[0]?.result.status).toBe("refused");
    mutateDuringListing = true;
    await handleBoardTownRpc(rpc);
    expect(calls).toEqual(["pane.list", "pane.list"]);
    expect(replies[1]?.result.status).toBe("refused");
  } finally {
    board.close();
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
