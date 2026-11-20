import { expect, mock, test } from "bun:test";

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
  type WorldObject = import("../worldObject").WorldObject;
  type TerminalKey = import("../agentProfiles").TerminalKey;
  const leaf = (id: string, connectionId = "alpha", extra = {}) => ({
    id,
    kind: "agent",
    connectionId,
    terminalId: "same-terminal",
    stale: false,
    capabilities: { openSpaces: true },
    ...extra,
  });
  test("docking follows the synced holder across observations and never its namesake", async () => {
    const dock = mock<(key: string) => void>(() => {});
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe({
      leaves,
      holder,
      mobile,
    }: {
      leaves: unknown[];
      holder: TerminalKey | null;
      mobile: boolean;
    }) {
      useTownMaster({ leaves } as WorldObject, holder, mobile, dock);
      return null;
    }
    const holder = { connection_id: "alpha", terminal_id: "same-terminal" };
    const render = (
      leaves: unknown[],
      role: TerminalKey | null = holder,
      mobile = false,
    ) =>
      act(async () =>
        root.render(createElement(Probe, { leaves, holder: role, mobile })),
      );
    try {
      await render([leaf("namesake", "beta")]);
      expect(dock).not.toHaveBeenCalled();
      await render([leaf("stale", "alpha", { stale: true })]);
      expect(dock).not.toHaveBeenCalled();
      await render([leaf("shell", "alpha", { kind: "terminal" })]);
      expect(dock).not.toHaveBeenCalled();
      await render([leaf("phone")], holder, true);
      expect(dock).not.toHaveBeenCalled();
      await render([leaf("master")], null);
      expect(dock).not.toHaveBeenCalled();
      await render([leaf("master"), leaf("namesake", "beta")]);
      expect(dock.mock.calls).toEqual([["master"]]);
      await render([leaf("master")]);
      expect(dock.mock.calls).toEqual([["master"]]);
      await render([leaf("next", "beta")], {
        ...holder,
        connection_id: "beta",
      });
      expect(dock.mock.calls).toEqual([["master"], ["next"]]);
      await render([leaf("master")]);
      expect(dock.mock.calls).toEqual([["master"], ["next"]]);
    } finally {
      await act(async () => root.unmount());
    }
  });
}
