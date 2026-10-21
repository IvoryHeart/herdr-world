import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";

// History and popstate are global, and the hook installs a module-level
// popstate listener; keep this DOM out of the shared test runner.
if (process.env.ROAMGATE_SYSTEM_BACK_DOM_TEST !== "1") {
  test("system Back regressions in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, ROAMGATE_SYSTEM_BACK_DOM_TEST: "1" },
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
  await registerDomTests();
}

async function registerDomTests() {
  const browser = new Window({ url: "http://localhost/" });
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  afterAll(() => browser.happyDOM.abort());

  const { act, createElement, Fragment, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { initializeLayoutPreferences, updateLayoutPreferences } = await import(
    "./layoutPreferences"
  );
  // Model only standard history operations. Traversals complete on an event,
  // never a wall-clock sleep (happy-dom does not implement session history).
  let entries: { state: object | null; url: string }[] = [
    { state: null, url: "/" },
  ];
  let index = 0;
  const traversals: (() => void)[] = [];
  const history = {
    get state() {
      return entries[index]!.state;
    },
    get length() {
      return entries.length;
    },
    pushState(state: object | null, _unused: string, url?: string) {
      entries = entries.slice(0, index + 1);
      entries.push({ state, url: url ?? entries[index]!.url });
      index++;
    },
    replaceState(state: object | null, _unused: string, url?: string) {
      entries[index] = { state, url: url ?? entries[index]!.url };
    },
    back() {
      move(-1);
    },
    forward() {
      move(1);
    },
    go(delta: number) {
      move(delta);
    },
  };
  function move(delta: number) {
    traversals.push(() => {
      const next = index + delta;
      if (next < 0 || next >= entries.length) return;
      index = next;
      browser.dispatchEvent(
        new browser.PopStateEvent("popstate", { state: history.state }),
      );
    });
  }
  Object.defineProperty(browser, "history", { value: history });
  // Simulate a refresh starting on a guard, before the module is imported.
  history.pushState(null, "", "/a");
  history.pushState(null, "", "/b");
  history.pushState({ herdrBack: true }, "");
  const { useSystemBack } = await import("./systemBack");

  type Name = "sheet" | "more" | "composer" | "files";
  const levels = {
    sheet: "popup",
    more: "popup",
    composer: "panel",
    files: "panel",
  } as const;
  let open = new Set<Name>();
  let closed: Name[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);

  // Composer is a child of the sheet so React runs its effects first when
  // both activate in one commit; stacking must not depend on that order.
  function Layer({ name, children }: { name: Name; children?: ReactNode }) {
    useSystemBack(
      open.has(name),
      () => {
        closed.push(name);
        show([...open].filter((candidate) => candidate !== name));
      },
      levels[name],
    );
    return createElement(Fragment, null, children);
  }
  function render() {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          Layer,
          { name: "sheet" },
          createElement(Layer, { name: "composer" }),
        ),
        createElement(Layer, { name: "files" }),
        createElement(Layer, { name: "more" }),
      ),
    );
  }
  function show(names: Name[]) {
    open = new Set(names);
    render();
  }
  const settle = async () => {
    // Each traversal can schedule a React commit and one guard reconcile.
    for (let turn = 0; turn < 8; turn++) {
      await act(async () => {
        await Promise.resolve();
        for (const complete of traversals.splice(0)) complete();
      });
      if (!traversals.length) {
        await Promise.resolve();
        if (!traversals.length) return;
      }
    }
    throw new Error("history traversal loop");
  };
  async function set(names: Name[]) {
    await act(async () => show(names));
    await settle();
  }
  async function userBack() {
    browser.history.back();
    await settle();
  }
  const guarded = () =>
    typeof browser.history.state === "object" &&
    browser.history.state !== null &&
    "herdrBack" in browser.history.state;
  const at = () => entries[index]!.url;
  // Every case starts on /b, reached from /a, with nothing open.
  async function start() {
    await set([]);
    browser.history.pushState(null, "", "/a");
    browser.history.pushState(null, "", "/b");
    closed = [];
  }

  initializeLayoutPreferences();
  updateLayoutPreferences({ mode: "mobile" });

  test("refresh on an empty guard returns to its base without a duplicate Back stop", async () => {
    await settle();
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("one Back leaves the page after layers close together", async () => {
    await start();
    await set(["files", "composer"]);
    expect(guarded()).toBe(true);
    await set([]);
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Back closes one layer at a time, mixed with on-screen closes", async () => {
    await start();
    await set(["composer"]);
    await set(["composer", "sheet"]);
    await userBack();
    expect(closed).toEqual(["sheet"]);
    expect([open.has("composer"), guarded()]).toEqual([true, true]);
    await set([]);
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Back pushes no entry, so a browser cannot skip the page on the next Back", async () => {
    // Browsers skip entries a page pushes without a user gesture; each layer's
    // guard is pushed when it opens, never while handling Back.
    await start();
    await set(["composer"]);
    await set(["composer", "sheet"]);
    const pushState = history.pushState;
    let pushes = 0;
    history.pushState = (...args: Parameters<typeof pushState>) => {
      pushes++;
      pushState(...args);
    };
    await userBack();
    expect(closed).toEqual(["sheet"]);
    await userBack();
    expect(closed).toEqual(["sheet", "composer"]);
    expect([at(), guarded()]).toEqual(["/b", false]);
    history.pushState = pushState;
    expect(pushes).toBe(0);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Tabs and More replacement shares one Back guard above the current view", async () => {
    await start();
    await set(["files", "sheet"]);
    const guardState = browser.history.state;
    const guardLength = browser.history.length;
    await set(["files", "more"]);
    expect(browser.history.state).toBe(guardState);
    expect(browser.history.length).toBe(guardLength);
    await set(["files", "sheet"]);
    expect(browser.history.state).toBe(guardState);
    await userBack();
    expect(closed).toEqual(["sheet"]);
    expect([...open]).toEqual(["files"]);
    await userBack();
    expect(closed).toEqual(["sheet", "files"]);
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("the higher level closes first when layers register together", async () => {
    await start();
    await set(["sheet", "composer"]);
    await act(async () => updateLayoutPreferences({ mode: "desktop" }));
    await settle();
    expect(guarded()).toBe(false);
    await act(async () => updateLayoutPreferences({ mode: "mobile" }));
    await settle();
    await userBack();
    expect(closed).toEqual(["sheet"]);
    expect(open.has("composer")).toBe(true);
    await set([]);
  });

  test("a layer opened while a Back is pending keeps its entry", async () => {
    await start();
    await set(["sheet"]);
    await act(async () => show([]));
    expect(traversals).toHaveLength(1);
    await act(async () => show(["files"]));
    await settle();
    expect([open.has("files"), guarded(), at()]).toEqual([true, true, "/b"]);
    await userBack();
    expect(closed).toEqual(["files"]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Forward at the end still lets one Back leave the empty guard", async () => {
    await start();
    await set(["composer"]);
    await set([]);
    const length = history.length;
    history.forward();
    await settle();
    expect([at(), guarded(), history.length]).toEqual(["/b", true, length]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Forward crosses every empty layer guard at the end, and one Back leaves", async () => {
    await start();
    await set(["composer", "sheet"]);
    await set([]);
    const length = history.length;
    history.forward();
    await settle();
    expect([at(), history.length]).toEqual(["/b", length]);
    expect(history.state).toMatchObject({ herdrBack: 2 });
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Forward crosses every empty layer guard to a later entry", async () => {
    await start();
    await set(["composer", "sheet"]);
    history.pushState({ later: true }, "", "/c");
    await set([]);
    await userBack();
    expect([at(), guarded()]).toEqual(["/b", false]);
    history.forward();
    await settle();
    expect(at()).toBe("/c");
    await userBack();
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("Forward and Back cross an empty guard without trapping later entries", async () => {
    await start();
    await set(["composer"]);
    // A later same-document entry can remain beyond the obsolete guard.
    history.pushState({ later: true }, "", "/c");
    await set([]);
    await userBack();
    expect([at(), guarded()]).toEqual(["/b", false]);
    expect(entries[entries.length - 1]).toEqual({
      state: { later: true },
      url: "/c",
    });
    history.forward();
    await settle();
    expect(at()).toBe("/c");
    await userBack();
    expect([at(), guarded()]).toEqual(["/b", false]);
    await userBack();
    expect(at()).toBe("/a");
  });

  test("pagehide does not traverse during document departure", async () => {
    await start();
    await set(["composer"]);
    browser.dispatchEvent(new browser.Event("pagehide"));
    await act(async () => root.unmount());
    await settle();
    expect(guarded()).toBe(true);
    browser.dispatchEvent(new browser.Event("pageshow"));
    await settle();
    expect(guarded()).toBe(false);
    root = createRoot(container);
  });

  test("World unmount preserves history; desktop remount removes its unused guard", async () => {
    await start();
    await set(["composer"]);
    await act(async () => root.unmount());
    await settle();
    expect([guarded(), at()]).toEqual([true, "/b"]);
    root = createRoot(container);
    await act(async () => updateLayoutPreferences({ mode: "desktop" }));
    await set(["composer"]);
    expect(guarded()).toBe(false);
    await userBack();
    expect(at()).toBe("/a");
    await act(async () => updateLayoutPreferences({ mode: "mobile" }));
    await set([]);
  });
}
