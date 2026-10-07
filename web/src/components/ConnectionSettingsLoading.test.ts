import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConnectionClient } from "../api";
import * as connectionHook from "../useConnectionClient";
import * as stores from "../store";
import { AgentIntegrationsSettings } from "./AgentIntegrationsSettings";
import { AutoSyncRepositoriesDialog } from "./AutoSyncRepositoriesDialog";

if (process.env.HERDR_CONNECTION_SETTINGS_DOM_TEST !== "1") {
  test("connection settings loading in an isolated DOM runtime", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, HERDR_CONNECTION_SETTINGS_DOM_TEST: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  let root: Root | undefined;
  let host: HTMLDivElement;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    host?.remove();
    mock.restore();
  });

  async function renderSettings(
    kind: "integrations" | "repositories",
    client: ConnectionClient,
  ) {
    spyOn(connectionHook, "useConnectionClient").mockReturnValue(client);
    spyOn(stores, "useOperationalStore").mockReturnValue({
      setWorkspaceAutoSyncConfigEnabled: async () => true,
    } as unknown as ReturnType<typeof stores.useOperationalStore>);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        kind === "integrations"
          ? createElement(AgentIntegrationsSettings, {
              connectionLabel: "Synthetic host",
            })
          : createElement(AutoSyncRepositoriesDialog, {
              open: true,
              onClose() {},
            }),
      ),
    );
  }

  function client(
    call: ConnectionClient["call"],
    current = true,
  ): ConnectionClient {
    return {
      connectionId: "synthetic",
      generation: 1,
      serverRuntimeGeneration: 1,
      call,
      isCurrent: () => current,
      acceptsServerGeneration: (value) => value === 1,
    };
  }

  test.each(["integrations", "repositories"] as const)(
    "%s dismisses loading when its captured host is unavailable",
    async (kind) => {
      await renderSettings(
        kind,
        client(async () => {
          throw new Error("connection runtime generation is unavailable");
        }, false),
      );
      expect(host.textContent).not.toContain("Loading");
      expect(host.textContent).toContain("no longer available");
      expect(host.textContent).not.toContain("No saved repositories");
    },
  );

  test.each(["integrations", "repositories"] as const)(
    "%s shows unsupported APIs instead of loading forever",
    async (kind) => {
      await renderSettings(
        kind,
        client(async () => {
          throw new Error("method not found");
        }),
      );
      expect(host.textContent).not.toContain("Loading");
      expect(host.textContent).toContain("method not found");
      expect(host.textContent).not.toContain("No saved repositories");
    },
  );

  test("repository polling does not supersede a slow initial load", async () => {
    let tick: (() => void) | undefined;
    spyOn(window, "setInterval").mockImplementation(((callback: () => void) => {
      tick = callback;
      return 123;
    }) as typeof window.setInterval);
    spyOn(window, "clearInterval").mockImplementation(() => {});
    const result = Promise.withResolvers<any>();
    const call = mock(() => result.promise);
    await renderSettings("repositories", client(call));
    expect(host.textContent).toContain("Loading repository configurations");
    await act(async () => tick!());
    await act(async () =>
      result.resolve({ configs: [], path: "/synthetic/settings.json" }),
    );
    expect(host.textContent).not.toContain("Loading");
    expect(host.textContent).toContain("No saved repositories");
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("a mutation refresh cannot admit polling while an older list is still pending", async () => {
    let tick: (() => void) | undefined;
    spyOn(window, "setInterval").mockImplementation(((callback: () => void) => {
      tick = callback;
      return 123;
    }) as typeof window.setInterval);
    spyOn(window, "clearInterval").mockImplementation(() => {});
    const result = Promise.withResolvers<any>();
    const data = {
      configs: [{ key: "synthetic", enabled: true, interval_minutes: 5 }],
      path: "/synthetic/settings.json",
    };
    const call = mock(() => Promise.resolve(data));
    await renderSettings("repositories", client(call));
    call.mockImplementationOnce(() => result.promise);
    await act(async () => tick!());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
    );
    expect(call).toHaveBeenCalledTimes(3);
    await act(async () => tick!());
    const callsWhilePending = call.mock.calls.length;
    await act(async () => result.resolve(data));
    expect(callsWhilePending).toBe(3);
    await act(async () => tick!());
    expect(call).toHaveBeenCalledTimes(4);
  });
}
