import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConnectionRecoveryBanner,
  reconnectCachedHost,
} from "./ConnectionRecoveryBanner";

test("failed-host recovery is explicit and snapshot uncertainty is not called disconnected", () => {
  const html = renderToStaticMarkup(
    <ConnectionRecoveryBanner
      connectionId="synthetic-a"
      label="Synthetic A"
      state="error"
    />,
  );
  expect(html).toContain("Disconnected");
  expect(html).toContain("Reconnect");
  expect(html).toContain('aria-label="Reconnect Synthetic A"');
  const stale = renderToStaticMarkup(
    <ConnectionRecoveryBanner
      connectionId="synthetic-a"
      label="Synthetic A"
      state="ready"
    />,
  );
  expect(stale).toContain("Stale");
  expect(stale).not.toContain("Disconnected");
});

test("recovery captures one profile and refreshes after its existing recovery verb", async () => {
  const calls: unknown[] = [];
  let selected = "synthetic-a";
  const task = reconnectCachedHost(selected, {
    call: async (method, params) => {
      calls.push([method, params.id]);
      selected = "healthy-b";
    },
    refresh: async () => {
      calls.push("refresh");
    },
  });
  await task;
  expect(selected).toBe("healthy-b");
  expect(calls).toEqual([
    ["connections.disconnect", "synthetic-a"],
    ["connections.connect", "synthetic-a"],
    "refresh",
  ]);
});

test("failed disconnect never issues connect and still refreshes diagnostics", async () => {
  const calls: string[] = [];
  await expect(
    reconnectCachedHost("synthetic-a", {
      call: async (method) => {
        calls.push(method);
        throw new Error("synthetic failure");
      },
      refresh: async () => {
        calls.push("refresh");
      },
    }),
  ).rejects.toThrow("synthetic failure");
  expect(calls).toEqual(["connections.disconnect", "refresh"]);
});
