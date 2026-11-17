import { afterAll, expect, mock, test } from "bun:test";
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
  const coreControl = await import("./coreControl");
  const coreLaunches: unknown[] = [];
  mock.module("./coreControl", () => ({
    ...coreControl,
    launchInCore: async (target: unknown, choice: unknown) => {
      coreLaunches.push({ target, choice });
      return { status: "started", terminal_id: "t9", placed: false };
    },
  }));
  const { store } = await import("../store");
  const { AgentLauncherDialog } = await import("./AgentLauncherDialog");
  afterAll(() => browser.happyDOM.close());

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
    }
  });

  test("core first: with no room asked for, a new agent starts in herdr-core", async () => {
    const tui = {
      id: "tui:w1",
      connectionId: "tui",
      generation: 3,
      nativeId: "w1",
      label: "web",
      hostLabel: "This computer",
      actionable: true,
      stale: false,
    } as WorldSpaceObject;
    const core = {
      ...tui,
      id: "box-core:hc:unplaced",
      connectionId: "box-core",
      generation: 5,
      nativeId: "hc:unplaced",
      label: "box",
      actionable: false,
      viewOnly:
        "World can't type into herdr-core terminals or chat with them yet",
      coreControl: true,
    } as WorldSpaceObject;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    catalogs.length = 0;
    let closed = 0;
    try {
      await act(async () =>
        root.render(
          h(AgentLauncherDialog, {
            world: { spaces: [tui, core] } as WorldObject,
            initial: {},
            onOpen() {
              throw new Error("a core terminal has no World window yet");
            },
            onEditProfiles() {},
            onClose() {
              closed += 1;
            },
          }),
        ),
      );
      expect(host.querySelector("select")!.value).toBe(core.id);
      expect(host.textContent).toContain(
        "Starts in herdr-core. Herdr's apps show the agent and keep it running",
      );
      expect(host.textContent).toContain("not shown in Herdr's apps");
      expect(catalogs).toEqual([
        {
          connectionId: "box-core",
          generation: 5,
          workspaceId: "hc:unplaced",
          runtime: "herdr-core",
        } as LaunchTarget,
      ]);
      const terminal = host.querySelector<HTMLButtonElement>(
        ".agent-launcher-card",
      )!;
      await act(async () => terminal.click());
      expect(coreLaunches).toEqual([
        {
          target: {
            connectionId: "box-core",
            generation: 5,
            workspaceId: "hc:unplaced",
            workspaceLabel: "box",
            runtime: "herdr-core",
          },
          choice: { label: "Shell", text: "", shell: true },
        },
      ]);
      expect(closed).toBe(1);
      // The TUI stays a per-launch choice: an asked-for TUI room is kept.
      await act(async () =>
        root.render(
          h(AgentLauncherDialog, {
            key: "tui",
            world: { spaces: [tui, core] } as WorldObject,
            initial: { connectionId: "tui", generation: 3, workspaceId: "w1" },
            onOpen() {},
            onEditProfiles() {},
            onClose() {},
          }),
        ),
      );
      expect(host.querySelector("select")!.value).toBe(tui.id);
      expect(host.textContent).toContain("Starts in Herdr (TUI).");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
}
