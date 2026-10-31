import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ConnectionClient } from "../api";
import type { Workspace, WorktreeList } from "../types";
import { installTestClock } from "../world/testing/testClock";

if (process.env.WORLD_WORKTREE_LIFECYCLE_TEST !== "1") {
  test("worktree resource policy in an isolated DOM on test time", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_WORKTREE_LIFECYCLE_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const dom = new Window({ url: "https://world.example.test" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  // Install before importing React DOM and the real dialog. All timer/frame
  // callbacks run on controlled time, with real task turns for promise jobs.
  const clock = installTestClock(dom as unknown as Window & typeof globalThis, {
    now: () => 0,
  });
  for (const key of [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const)
    Object.defineProperty(globalThis, key, {
      value: dom[key].bind(dom),
      configurable: true,
    });
  const { createRoot } = await import("react-dom/client");
  const realStore = await import("../store");
  const realClient = await import("../useConnectionClient");
  const { WORKSPACE_INSPECTOR_REQUEST_EVENT } = await import(
    "../workspaceResource"
  );
  type Request = import("../workspaceResource").WorkspaceInspectorRequest;
  const source: Workspace = {
    workspace_id: "source-workspace",
    label: "Source",
    number: 1,
    focused: false,
    pane_count: 1,
    tab_count: 1,
    agent_status: "idle",
    worktree: {
      repo_key: "/synthetic/repo/.git",
      repo_name: "Synthetic",
      repo_root: "/synthetic/repo",
      checkout_path: "/synthetic/repo",
      is_linked_worktree: false,
    },
  };
  const checkout: Workspace = {
    ...source,
    workspace_id: "opened-workspace",
    label: "Feature",
    number: 2,
    worktree: {
      ...source.worktree!,
      checkout_path: "/synthetic/feature",
      is_linked_worktree: true,
    },
  };
  const inventory: WorktreeList = {
    type: "worktree_list",
    source: {
      repo_key: source.worktree!.repo_key,
      repo_name: "Synthetic",
      repo_root: "/synthetic/repo",
      source_checkout_path: "/synthetic/repo",
      source_workspace_id: source.workspace_id,
    },
    worktrees: [
      {
        path: "/synthetic/feature",
        label: "Feature",
        branch: "feature",
        is_linked_worktree: true,
        is_bare: false,
        is_detached: false,
        is_prunable: false,
      },
    ],
  };
  const snapshot = { ...realStore.store.get(), workspaces: [source] };
  let current = true,
    opened = false,
    closed = 0,
    rejectValidation = false,
    metadata = true,
    acceptAdmission = false;
  let openGate: ReturnType<typeof Promise.withResolvers<void>> | null = null;
  let openEntered: ReturnType<typeof Promise.withResolvers<void>>;
  let root: ReturnType<typeof createRoot> | null;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const requests: Request[] = [];
  let client: ConnectionClient;
  // These are synthetic service/operational ports, deliberately unfenced so
  // the real dialog must reject late replies itself. They do not replace RPC
  // lease coverage or the browser's real Inspector/focus/publication consumers.
  const ownedStore = {
    get: () => snapshot,
    refresh: async () => {},
    openWorktree: async (workspaceId: string, path: string, focus: boolean) => {
      calls.push({
        method: "worktree.open",
        params: { workspace_id: workspaceId, path, focus },
      });
      openEntered.resolve();
      await openGate?.promise;
      opened = true;
      return { workspace: checkout };
    },
  };
  mock.module("../store", () => ({
    ...realStore,
    useStoreSelector: (selector: (state: typeof snapshot) => unknown) =>
      selector(snapshot),
    useOperationalStore: () => ownedStore,
  }));
  mock.module("../useConnectionClient", () => ({
    ...realClient,
    useConnectionClient: () => client,
  }));
  const { WorktreeLifecycleDialog } = await import("./WorktreeLifecycleDialog");
  const receiver = (event: Event) => {
    event.preventDefault();
    const request = (event as CustomEvent<Request>).detail;
    requests.push(request);
    request.onAdmission?.(acceptAdmission);
  };
  const frame = () => act(() => clock.frame());
  const targetRow = () =>
    [...dom.document.querySelectorAll(".lifecycle-row")].find(
      (row) => row.querySelector("code")?.textContent === "/synthetic/feature",
    )!;
  async function click(label: string) {
    const scope = label === "Files" ? targetRow() : dom.document;
    const button = [...scope.querySelectorAll("button")].find(
      (node) =>
        node.getAttribute("aria-label") === label ||
        node.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await clock.frame();
    });
  }
  function opens() {
    return calls.filter(({ method }) => method === "worktree.open");
  }
  async function firstFailure() {
    await click("Files");
    expect(opens()).toHaveLength(1);
    expect(opens()[0]!.params).toEqual({
      workspace_id: source.workspace_id,
      path: "/synthetic/feature",
      focus: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      connectionId: "beta",
      generation: 1,
      runtimeGeneration: 7,
      workspaceId: checkout.workspace_id,
      view: "files",
    });
    expect(closed).toBe(0);
    expect(
      dom.document.querySelector(".lifecycle-operation.is-failed")?.textContent,
    ).toContain("checkout is open");
    expect(
      targetRow().querySelector(".lifecycle-open-state")?.textContent,
    ).toBe("Open");
  }
  beforeEach(async () => {
    current = true;
    opened = false;
    closed = 0;
    rejectValidation = false;
    metadata = true;
    acceptAdmission = false;
    openGate = null;
    openEntered = Promise.withResolvers<void>();
    calls.length = 0;
    requests.length = 0;
    client = {
      connectionId: "beta",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => current,
      acceptsServerGeneration: (generation) => generation === 7,
      call: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "workspace.list") {
          if (rejectValidation)
            throw new Error("Synthetic workspace validation failed");
          return {
            workspaces: [
              source,
              ...(opened
                ? [
                    {
                      ...checkout,
                      worktree: metadata ? checkout.worktree : undefined,
                    },
                  ]
                : []),
            ],
          };
        }
        if (method === "worktree.list") return inventory;
        if (method === "settings.worktree_hooks.get")
          return { key: null, enabled: false };
        if (method === "settings.workspace_auto_sync.get")
          return {
            workspace_id: params.workspace_id,
            enabled: false,
            running: false,
          };
        return {};
      },
    } as ConnectionClient;
    window.addEventListener(WORKSPACE_INSPECTOR_REQUEST_EVENT, receiver);
    const element = dom.document.createElement("div");
    dom.document.body.append(element);
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(WorktreeLifecycleDialog, {
          open: true,
          workspaceId: source.workspace_id,
          onClose: () => {
            closed++;
          },
        }),
      );
      await clock.frame();
    });
    expect(dom.document.querySelector(".lifecycle-row")).not.toBeNull();
  });
  afterEach(async () => {
    await act(() => root?.unmount());
    root = null;
    openGate?.resolve();
    await frame();
    window.removeEventListener(WORKSPACE_INSPECTOR_REQUEST_EVENT, receiver);
    dom.document.body.replaceChildren();
  });

  test.each(["retirement", "disposal"])(
    "%s during worktree.open cannot request a replacement resource or report success",
    async (reason) => {
      openGate = Promise.withResolvers<void>();
      await click("Files");
      await openEntered.promise;
      expect(opens()).toHaveLength(1);
      if (reason === "disposal") {
        await act(() => root!.unmount());
        root = null;
      } else current = false;
      openGate.resolve();
      await frame();
      expect(opens()).toHaveLength(1);
      expect(requests).toHaveLength(0);
      expect(calls.some(({ method }) => method === "file.list")).toBe(false);
      expect(closed).toBe(0);
    },
  );

  test.each(["refresh", "retry"])(
    "%s after closing the cached workspace reopens the checkout exactly once",
    async (route) => {
      await firstFailure();
      opened = false;
      if (route === "refresh") {
        await click("Refresh lifecycle status");
        expect(
          targetRow().querySelector(".lifecycle-open-state")?.textContent,
        ).toBe("Closed");
      }
      acceptAdmission = true;
      await click("Files");
      expect(opens()).toHaveLength(2);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({
        connectionId: "beta",
        generation: 1,
        runtimeGeneration: 7,
        workspaceId: checkout.workspace_id,
        view: "files",
      });
      expect(closed).toBe(1);
    },
  );

  test("failed cached-target validation never replays the worktree opened hook", async () => {
    await firstFailure();
    rejectValidation = true;
    await click("Files");
    expect(
      dom.document.querySelector(".lifecycle-operation.is-failed")?.textContent,
    ).toContain("Synthetic workspace validation failed");
    expect(opens()).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(closed).toBe(0);
  });

  test("a live remembered target retries only the Inspector when checkout metadata still lags", async () => {
    metadata = false;
    await firstFailure();
    acceptAdmission = true;
    await click("Files");
    expect(opens()).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.workspaceId).toBe(checkout.workspace_id);
    expect(closed).toBe(1);
  });
}
