import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

if (process.env.HERDR_TOWN_SIGN_DOM_TEST !== "1") {
  test("building sign commit lifecycle in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_TOWN_SIGN_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(stderr.trim());
    expect(code).toBe(0);
  }, 15_000);
} else {
  const browser = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const {
    act,
    createElement: h,
    StrictMode,
    Suspense,
    Fragment,
  } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TownBuildingSigns } = await import("./townBuildingSigns");
  const { TownBuildingSign } = await import("./TownBuildingSign");
  afterAll(async () => browser.happyDOM.close());

  test("cold commit and cull/remount register real nodes without status ref churn", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let frames = 0;
    const signs = new TownBuildingSigns(() => frames++);
    const render = (label: string) =>
      h(
        StrictMode,
        null,
        h(TownBuildingSign, {
          hostKey: "synthetic-a",
          signs,
          left: 0,
          top: 0,
          children: label,
        }),
      );
    try {
      await act(async () => root.render(render("Disconnected · Reconnect")));
      const cold = container.querySelector<HTMLElement>(
        "[data-building-sign]",
      )!;
      expect(cold.isConnected).toBe(true);
      expect(frames).toBe(1);
      signs.update(() => 1);
      expect(cold.style.opacity).toBe("1");
      expect(cold.style.visibility).toBe("visible");
      await act(async () => root.render(render("Updated cached status")));
      expect(container.querySelector("[data-building-sign]")).toBe(cold);
      expect(frames).toBe(1);
      await act(async () => root.render(null));
      expect(cold.isConnected).toBe(false);
      signs.update(() => {
        throw new Error("a culled node must be unregistered");
      });
      await act(async () => root.render(render("Disconnected · Reconnect")));
      const next = container.querySelector<HTMLElement>(
        "[data-building-sign]",
      )!;
      expect(next).not.toBe(cold);
      expect(frames).toBe(2);
      signs.update(() => 0);
      expect(next.style.visibility).toBe("hidden");
      signs.update(() => 1);
      expect(next.style.visibility).toBe("visible");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    signs.update(() => {
      throw new Error("unmount must release all committed signs");
    });
  });

  test("a rendered but suspended tree never registers uncommitted sign refs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let frames = 0;
    const signs = new TownBuildingSigns(() => frames++);
    const pending = new Promise<void>(() => {});
    const Suspend = () => {
      throw pending;
    };
    try {
      await act(async () =>
        root.render(
          h(
            Suspense,
            { fallback: null },
            h(
              Fragment,
              null,
              h(TownBuildingSign, {
                hostKey: "synthetic-uncommitted",
                signs,
                left: 0,
                top: 0,
                children: "Uncommitted",
              }),
              h(Suspend),
            ),
          ),
        ),
      );
      expect(container.querySelector("[data-building-sign]")).toBeNull();
      expect(frames).toBe(0);
      signs.update(() => {
        throw new Error("uncommitted nodes must not leak into the registry");
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
