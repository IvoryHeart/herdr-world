import { expect, test } from "bun:test";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { readFocusedList, readFocusedLists } from "./focused-lists";

test("a failed list waits for sibling reads before releasing its observation slot", async () => {
  const pending = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const connection = {
    remotePlatform: "windows",
    herdr: {
      async call(method: string) {
        if (method === "pane.list") {
          entered.resolve();
          await pending.promise;
        }
        throw new Error(`synthetic ${method} failure`);
      },
    },
  } as unknown as LegacyConnectionRuntime;
  let settled = false;
  const reading = readFocusedLists(connection).then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await entered.promise;
  expect(settled).toBeFalse();
  pending.resolve();
  expect(await reading).toEqual(new Error("synthetic workspace.list failure"));
  expect(settled).toBeTrue();
});

test("Windows agent lists never use local activity enrichment", async () => {
  const connection = {
    remotePlatform: "windows",
    herdr: {
      async call() {
        return { agents: [{ pane_id: "synthetic-pane" }] };
      },
    },
    agentSessions: {
      listWithActivity() {
        throw new Error("must not read local sessions");
      },
    },
  } as unknown as LegacyConnectionRuntime;
  expect(await readFocusedList(connection, "agent.list")).toEqual({
    agents: [{ pane_id: "synthetic-pane" }],
  });
});
