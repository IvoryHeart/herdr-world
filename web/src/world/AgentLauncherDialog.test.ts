import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { LaunchTarget } from "./agentProfiles";
import type { WorldObject, WorldSpaceObject } from "./worldObject";

if (process.env.HERDR_LAUNCH_TARGET_DOM_TEST !== "1") {
  test("launcher target qualification in an isolated React runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_LAUNCH_TARGET_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const browser = new Window({ url: "https://world.example.test" });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    localStorage: browser.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const profiles = await import("./agentProfiles");
  const catalogs: LaunchTarget[] = [];
  mock.module("./agentProfiles", () => ({
    ...profiles,
    useAgentProfiles: () => ({ document: { profiles: [] } }),
    launcherCatalog: async (target: LaunchTarget) => {
      catalogs.push(target);
      return { kinds: [], readiness: [], skills: [] };
    },
  }));
  const { store } = await import("../store");
  const { AgentLauncherDialog } = await import("./AgentLauncherDialog");

  test("explicit room and generation never fall back; a deliberate choice and generic launch may select a current room", async () => {
    const space = (
      connectionId: string,
      generation: number,
      nativeId: string,
    ) =>
      ({
        id: `${connectionId}:${nativeId}`,
        connectionId,
        generation,
        nativeId,
        label: nativeId,
        hostLabel: connectionId,
        actionable: true,
        stale: false,
      }) as WorldSpaceObject;
    const alpha = space("alpha", 7, "requested-room");
    const beta = space("beta", 9, "other-room");
    const nextAlpha = { ...alpha, generation: 8 };
    const initial = {
      connectionId: "alpha",
      generation: 7,
      workspaceId: "requested-room",
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const created: {
      connectionId: string;
      runtimeGeneration: number;
      workspaceId: string;
    }[] = [];
    const original = store.createQualifiedTab;
    store.createQualifiedTab = async (owner, workspaceId) => {
      created.push({ ...owner, workspaceId });
    };
    const render = (
      spaces: WorldSpaceObject[],
      target: Partial<LaunchTarget>,
      key: string,
    ) =>
      act(async () =>
        root.render(
          h(AgentLauncherDialog, {
            key,
            world: { spaces } as WorldObject,
            initial: target,
            onOpen() {},
            onEditProfiles() {},
            onClose() {},
          }),
        ),
      );
    const terminal = () =>
      host.querySelector<HTMLButtonElement>(".agent-launcher-card")!;
    const choose = async (room: WorldSpaceObject) => {
      await act(async () => {
        const select = host.querySelector("select")!;
        select.value = room.id;
        select.dispatchEvent(
          new browser.Event("change", { bubbles: true }) as unknown as Event,
        );
      });
    };
    const blocked = async () => {
      expect(host.querySelector("select")!.value).toBe("");
      expect(host.textContent).toContain("requested room is unavailable");
      expect(terminal().disabled).toBe(true);
      await act(async () => terminal().click());
    };
    try {
      // The room disappears between the Town seat event and the dialog mount.
      await render([beta], initial, "removed-before-mount");
      await blocked();
      expect(created).toEqual([]);
      expect(catalogs).toEqual([]);
      await choose(beta);
      await act(async () => terminal().click());
      expect(created).toEqual([
        {
          connectionId: "beta",
          runtimeGeneration: 9,
          workspaceId: "other-room",
        },
      ]);
      created.length = 0;
      catalogs.length = 0;

      // A matching connection/workspace in a replacement runtime is not the request.
      await render([nextAlpha, beta], initial, "replaced-before-mount");
      await blocked();
      expect(created).toEqual([]);
      expect(catalogs).toEqual([]);

      await render([alpha, beta], initial, "replaced-after-mount");
      expect(terminal().disabled).toBe(false);
      await render([nextAlpha, beta], initial, "replaced-after-mount");
      await blocked();
      expect(created).toEqual([]);
      await choose(nextAlpha);
      await act(async () => terminal().click());
      expect(created).toEqual([
        {
          connectionId: "alpha",
          runtimeGeneration: 8,
          workspaceId: "requested-room",
        },
      ]);
      created.length = 0;

      await render([alpha, beta], {}, "generic");
      expect(terminal().disabled).toBe(false);
      await act(async () => terminal().click());
      expect(created).toEqual([
        {
          connectionId: "alpha",
          runtimeGeneration: 7,
          workspaceId: "requested-room",
        },
      ]);
    } finally {
      await act(async () => root.unmount());
      store.createQualifiedTab = original;
      host.remove();
      await browser.happyDOM.close();
    }
  });
}
