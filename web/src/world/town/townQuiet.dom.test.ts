import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TownBoard } from "./TownBoard";

const counts = {
  agents: 5,
  buildings: 1,
  working: 4,
  needsYou: 0,
  finished: 0,
  quiet: 1,
  unknown: 0,
  outOfFuel: 0,
};

test("the board's Busy count carries the quiet working agents and their find", () => {
  const board = renderToStaticMarkup(
    createElement(TownBoard, {
      counts,
      quiet: { count: 2, minutes: 10, onFind() {} },
    }),
  );
  expect(board).toContain("2 quiet 10 m+");
  expect(board).toContain(
    'aria-label="Find the 2 working agents with no progress for 10 minutes or more"',
  );
  // Help's Try finds the line, and the chip that opens the board.
  expect(board).toContain('data-help="town.quiet"');
  expect(board).toContain('data-help-opens="town.focus town.quiet"');
  // Nobody quiet: no line, and the chip opens only the focus controls.
  const calm = renderToStaticMarkup(createElement(TownBoard, { counts }));
  expect(calm).not.toContain("town-board-quiet");
  expect(calm).toContain('data-help-opens="town.focus"');
});

if (process.env.TOWN_QUIET_DOM !== "1") {
  test("the board's quiet find in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_QUIET_DOM: "1" },
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
  const { mock } = await import("bun:test");
  // The glyphs are painted on a canvas, which the test DOM lacks.
  mock.module("./townQuietGlyph", () => ({
    townQuietGlyphUrl: () => "data:image/png;base64,",
  }));
  mock.module("./townStepArt", () => ({
    townStepGlyphUrl: () => "data:image/png;base64,",
  }));
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useTownQuiet } = await import("./useTownQuiet");
  type Quiet = ReturnType<typeof useTownQuiet>;

  const MINUTE = 60_000;
  const now = Date.UTC(2026, 10, 20, 14, 30);
  const agent = (key: string, semanticStatus = "working") => ({
    agent: { key, nodeId: key, semanticStatus },
  });

  test("find shows the first quiet agent and Next steps through the rest", async () => {
    const shown: string[] = [];
    const times: Record<string, number> = {
      a: now - 25 * MINUTE,
      b: now - 1 * MINUTE,
      c: now - 14 * MINUTE,
      d: now - 40 * MINUTE,
    };
    const office = {
      roster: [agent("a"), agent("b"), agent("c"), agent("d")],
    } as never;
    let quiet!: Quiet;
    let minutes = 10;
    let activityAt = (each: { nodeId: string }) => times[each.nodeId];
    function Probe() {
      quiet = useTownQuiet(
        office,
        activityAt,
        now,
        { townQuietMinutes: minutes },
        (key) => shown.push(key),
      );
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () => act(async () => root.render(createElement(Probe)));
    await render();
    expect([...quiet.keys]).toEqual(["a", "c", "d"]);
    // A clock tick with nobody changed keeps the same set for the scene.
    const keys = quiet.keys;
    await render();
    expect(quiet.keys).toBe(keys);

    const anchor = { x: 0, y: 0 };
    expect(quiet.board?.count).toBe(3);
    expect(quiet.text("a")).toStartWith("No progress for 25 m (last ");
    expect(quiet.text("b")).toBeNull();
    await act(async () => quiet.board!.onFind(anchor));
    expect(shown).toEqual(["a"]);
    await act(async () => quiet.step("a", anchor)!());
    await act(async () => quiet.step("c", anchor)!());
    await act(async () => quiet.step("d", anchor)!());
    expect(shown).toEqual(["a", "c", "d", "a"]);

    // c's session moves: Next skips it, and the look clears.
    times.c = now - 2_000;
    activityAt = (each) => times[each.nodeId];
    await render();
    expect([...quiet.keys]).toEqual(["a", "d"]);
    await act(async () => quiet.step("a", anchor)!());
    expect(shown[shown.length - 1]).toBe("d");

    // A 30-minute threshold keeps fewer; one left has no Next.
    minutes = 30;
    await render();
    expect([...quiet.keys]).toEqual(["d"]);
    expect(quiet.step("d", anchor)).toBeNull();

    // Off: nobody is quiet.
    minutes = 0;
    await render();
    expect(quiet.keys.size).toBe(0);
    expect(quiet.board).toBeUndefined();
    await act(async () => root.unmount());
    host.remove();
  });

  test("help's Try for quiet agents pins the town board open on the Busy line", async () => {
    const { HELP_TRY_EVENT } = await import("../../help/helpEvents");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const show = (quiet?: { count: number; minutes: number; onFind(): void }) =>
      act(async () => root.render(createElement(TownBoard, { counts, quiet })));
    const tryHelp = (id: string) =>
      act(async () => {
        // The test DOM's own event class: Bun's global one is not its Event.
        const { CustomEvent } = window as unknown as typeof globalThis;
        window.dispatchEvent(
          new CustomEvent(HELP_TRY_EVENT, { detail: { id } }),
        );
      });
    const open = () =>
      host.querySelector("#town-board")?.getAttribute("data-open");

    // Nobody quiet: Try leaves the board folded (the panel says where).
    await show();
    await tryHelp("town.quiet");
    expect(open()).toBe("false");

    await show({ count: 2, minutes: 10, onFind() {} });
    // Another entry's Try does not open it.
    await tryHelp("town.zoom");
    expect(open()).toBe("false");
    await tryHelp("town.quiet");
    expect(open()).toBe("true");
    expect(
      host.querySelector("#town-board [data-help='town.quiet']")?.textContent,
    ).toBe("2 quiet 10 m+");
    await act(async () => root.unmount());
    host.remove();
  });

  test("a quiet agent's bubble carries how long it has gone quiet and its step's time", async () => {
    const { TownStepBubble } = await import("./TownStepBubble");
    const { TownStepStore } = await import("./townStepStore");
    const { TownHud } = await import("./scene/townHud");
    const hud = new TownHud({
      now: () => 0,
      wall: () => now,
      after: () => () => {},
    });
    const steps = new TownStepStore();
    // A short command step, not yet long enough for its own amber time.
    steps.set(
      new Map([
        ["a", { kind: "command", since: now - 4 * MINUTE, task: null }],
      ]),
    );
    const bubble = (agentKey: string, quietSince: number | null) =>
      createElement(TownStepBubble, {
        steps,
        quietSince,
        hud,
        agentKey,
        top: true,
        x: 20,
        selected: false,
        renderer: { current: null },
        pennants: new Set<HTMLElement>(),
      });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const show = (...nodes: ReturnType<typeof bubble>[]) =>
      act(async () => root.render(nodes));

    // Working and moving: the step's glyph alone, no hourglass.
    await show(bubble("a", null));
    expect(host.querySelector(".town-step-quiet")).toBeNull();
    expect(host.querySelector(".town-step-age")).toBeNull();

    // Quiet: the hourglass with its time, and the step's running time.
    await show(bubble("a", now - 23 * MINUTE));
    const quiet = host.querySelector(".town-step")!;
    expect(quiet.getAttribute("data-quiet")).toBe("23m");
    expect(quiet.querySelector(".town-step-quiet")?.textContent).toBe("23m");
    expect(quiet.querySelector(".town-step-quiet-glyph")).not.toBeNull();
    expect(quiet.querySelector(".town-step-age")?.textContent).toBe("4m");

    // A quiet agent with no step: the hourglass and its time alone.
    await show(bubble("b", now - 65 * MINUTE));
    expect(host.querySelector(".town-step-glyph")).toBeNull();
    expect(host.querySelector(".town-step-quiet")?.textContent).toBe("1h 05m");
    await act(async () => root.unmount());
    host.remove();
  });
}
