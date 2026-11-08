import { expect, test } from "bun:test";
import { bridge } from "../api";
import { moveTabInList } from "../tabReorder";
import { deskReorderIndex } from "../../../shared/tabOrder";
import {
  herdrOrderNeighbor,
  requestTabStep,
  requestWorkspaceStep,
} from "./herdrOrder";

/** A fake host: answers lists and records every call with its owner. */
function withHost(
  answer: (method: string) => unknown,
  run: (calls: [string, string, unknown][]) => Promise<void>,
) {
  const calls: [string, string, unknown][] = [];
  const connection = bridge.connection;
  bridge.connection = ((connectionId: string, generation: number) => ({
    connectionId,
    generation,
    serverRuntimeGeneration: generation,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params: unknown) => {
      calls.push([`${connectionId}@${generation}`, method, params]);
      return answer(method);
    },
  })) as unknown as typeof bridge.connection;
  return run(calls).finally(() => {
    bridge.connection = connection;
  });
}

test("a step's neighbour is the next one in Herdr's order, none at the ends", () => {
  const order = ["w1", "w2", "w3"];
  expect(herdrOrderNeighbor(order, "w2", -1)).toBe("w1");
  expect(herdrOrderNeighbor(order, "w2", 1)).toBe("w3");
  expect(herdrOrderNeighbor(order, "w1", -1)).toBeNull();
  expect(herdrOrderNeighbor(order, "w3", 1)).toBeNull();
  expect(herdrOrderNeighbor(order, "w9", 1)).toBeUndefined();
});

test("a tab stepped onto its neighbour's slot changes places with it", () => {
  const order = ["a", "b", "c"];
  const after = (tabId: string, ontoId: string) =>
    moveTabInList(
      order.map((tab_id) => ({ tab_id, workspace_id: "w" })),
      tabId,
      deskReorderIndex(order, tabId, ontoId)!,
    ).map(({ tab_id }) => tab_id);
  expect(after("a", herdrOrderNeighbor(order, "a", 1)!)).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(after("c", herdrOrderNeighbor(order, "c", -1)!)).toEqual([
    "a",
    "c",
    "b",
  ]);
});

test("a room steps in Herdr on its own host and generation, passing its neighbour", async () => {
  await withHost(
    (method) =>
      method === "workspace.list"
        ? {
            // Listed out of order: Herdr's order is the workspace number.
            workspaces: [
              { workspace_id: "w3", number: 3 },
              { workspace_id: "w1", number: 1 },
              { workspace_id: "w2", number: 2 },
            ],
          }
        : { type: "ok" },
    async (calls) => {
      const owner = { connectionId: "remote", generation: 4 };
      expect(await requestWorkspaceStep(owner, "w3", -1)).toEqual({
        status: "moved",
        neighbor: "w2",
      });
      expect(calls).toEqual([
        ["remote@4", "workspace.list", {}],
        ["remote@4", "workspace.move", { workspace_id: "w3", insert_index: 1 }],
      ]);
      calls.length = 0;
      expect(await requestWorkspaceStep(owner, "w1", 1)).toEqual({
        status: "moved",
        neighbor: "w2",
      });
      expect(calls.slice(1)).toEqual([
        ["remote@4", "workspace.move", { workspace_id: "w2", insert_index: 0 }],
      ]);
      // First already: refused, nothing moved.
      calls.length = 0;
      expect(await requestWorkspaceStep(owner, "w1", -1)).toMatchObject({
        status: "refused",
        reason: "edge",
      });
      expect(calls.map(([, method]) => method)).toEqual(["workspace.list"]);
      // A room Herdr no longer lists is refused too.
      calls.length = 0;
      expect(await requestWorkspaceStep(owner, "w9", 1)).toMatchObject({
        status: "refused",
        reason: "changed",
      });
      expect(calls.map(([, method]) => method)).toEqual(["workspace.list"]);
    },
  );
});

test("a tab already last in its room is refused before any tab.move", async () => {
  await withHost(
    () => ({
      tabs: [
        { tab_id: "w1:t1", workspace_id: "w1" },
        { tab_id: "w1:t2", workspace_id: "w1" },
        { tab_id: "w2:t1", workspace_id: "w2" },
      ],
    }),
    async (calls) => {
      expect(
        await requestTabStep(
          { connectionId: "remote", generation: 4 },
          "w1:t2",
          1,
        ),
      ).toMatchObject({ status: "refused", reason: "edge" });
      expect(calls).toEqual([["remote@4", "tab.list", {}]]);
    },
  );
});
