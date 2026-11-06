import { expect, mock, test } from "bun:test";
import type { OfficeAgent } from "../herdrOfficeProjection";

if (process.env.TOWN_MASTER_DOM !== "1") {
  test("Town master lookup and docking in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_MASTER_DOM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useTownMaster } = await import("./useTownMaster");
  const named = (key: string, agentName = "firstmate") =>
    ({ key, agentName, displayLabel: agentName }) as OfficeAgent;
  const longRoster = (prefix: string) => [
    ...Array.from({ length: 600 }, (_, i) => ({
      agent: named(`${prefix}-worker-${i}`, "worker"),
    })),
    { agent: named(`${prefix}-master`) },
  ];
  function controlledTasks() {
    const before = Object.getOwnPropertyDescriptor(globalThis, "scheduler");
    const pending: (() => void)[] = [];
    Object.defineProperty(globalThis, "scheduler", {
      configurable: true,
      value: {
        postTask(task: () => void) {
          return new Promise<void>((resolve) =>
            pending.push(() => {
              task();
              resolve();
            }),
          );
        },
      },
    });
    return {
      pending,
      release() {
        for (const task of pending.splice(0)) task();
      },
      restore() {
        if (before) Object.defineProperty(globalThis, "scheduler", before);
        else Reflect.deleteProperty(globalThis, "scheduler");
      },
    };
  }
  function mounted(dock: (key: string) => void) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let live = true;
    function Probe(props: {
      roster: readonly { agent: OfficeAgent }[];
      mobile: boolean;
      name: string;
    }) {
      useTownMaster(props.roster, props.name, props.mobile, dock);
      return null;
    }
    return {
      async render(
        roster: readonly { agent: OfficeAgent }[],
        mobile = false,
        name = "firstmate",
      ) {
        await act(async () =>
          root.render(createElement(Probe, { roster, mobile, name })),
        );
      },
      async close() {
        if (!live) return;
        live = false;
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }
  test("mobile Town does not search the complete roster", async () => {
    const roster = new Proxy([], {
      get() {
        throw new Error("mobile Town searched the complete roster");
      },
    });
    const dock = mock<(key: string) => void>(() => {});
    function Probe() {
      useTownMaster(roster, "firstmate", true, dock);
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Probe)));
      expect(dock).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  test("a docked master stays closed across subsequent observations", async () => {
    const dock = mock<(key: string) => void>(() => {});
    const view = mounted(dock);
    try {
      await view.render([{ agent: named("once-master") }]);
      expect(dock.mock.calls).toEqual([["once-master"]]);
      await view.render([{ agent: named("once-master") }]);
      expect(dock.mock.calls).toEqual([["once-master"]]);
    } finally {
      await view.close();
    }
  });
  test("a newer roster retires the pending master lookup", async () => {
    const tasks = controlledTasks();
    const dock = mock<(key: string) => void>(() => {});
    const view = mounted(dock);
    try {
      await view.render(longRoster("old-roster"));
      expect(tasks.pending.length).toBeGreaterThan(0);
      expect(dock).not.toHaveBeenCalled();
      await view.render([{ agent: named("current-roster-master") }]);
      await act(async () => tasks.release());
      expect(dock.mock.calls).toEqual([["current-roster-master"]]);
    } finally {
      await view.close();
      tasks.restore();
    }
  });
  test.each(["mobile", "name", "unmount"])(
    "%s changes retire a pending master lookup",
    async (mode) => {
      const tasks = controlledTasks();
      const dock = mock<(key: string) => void>(() => {});
      const view = mounted(dock);
      try {
        const roster = longRoster(mode);
        await view.render(roster);
        expect(tasks.pending.length).toBeGreaterThan(0);
        if (mode === "unmount") await view.close();
        else
          await view.render(
            roster,
            mode === "mobile",
            mode === "name" ? "worker" : "firstmate",
          );
        await act(async () => tasks.release());
        expect(dock.mock.calls).toEqual(
          mode === "name" ? [[`${mode}-worker-0`]] : [],
        );
      } finally {
        await view.close();
        tasks.restore();
      }
    },
  );
}
