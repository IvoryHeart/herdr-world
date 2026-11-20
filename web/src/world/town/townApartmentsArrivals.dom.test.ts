import { expect, test } from "bun:test";

if (process.env.TOWN_ARRIVALS_DOM !== "1") {
  test("Apartments arrivals in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_ARRIVALS_DOM: "1" },
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
  const {
    TOWN_ARRIVAL_MS,
    resetTownApartmentsArrivals,
    townApartmentsArrive,
    townApartmentsCount,
    useTownApartmentsArrivals,
  } = await import("./townApartmentsArrivals");

  // A manual clock for the hook's own timer; React keeps the real ones it
  // captured on import.
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  Object.defineProperty(performance, "now", {
    value: () => clock,
    configurable: true,
  });
  globalThis.setTimeout = ((run: () => void, delay = 0) => {
    const id = nextId++;
    timers.set(id, { at: clock + Math.max(0, delay), run });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    timers.delete(id);
  }) as unknown as typeof clearTimeout;
  const advanceTo = (time: number) => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      clock = timer.at;
      act(() => timer.run());
    }
    clock = time;
  };

  test("each rider whose close never lands stops counting on its own deadline", () => {
    resetTownApartmentsArrivals();
    let count = -1;
    const Sign = () => {
      const { pending, now } = useTownApartmentsArrivals();
      count = townApartmentsCount([], pending, now);
      return null;
    };
    const root = createRoot(document.createElement("div") as never);
    act(() => root.render(createElement(Sign)));
    expect(count).toBe(0);

    // Two riders walk in 700 ms apart; neither becomes a resident.
    advanceTo(1_000);
    act(() =>
      townApartmentsArrive({
        id: "a",
        connection_id: "c1",
        terminal_id: "t-a",
        at: 1_000,
      }),
    );
    advanceTo(1_700);
    act(() =>
      townApartmentsArrive({
        id: "b",
        connection_id: "c1",
        terminal_id: "t-b",
        at: 1_700,
      }),
    );
    expect(count).toBe(2);

    advanceTo(1_000 + TOWN_ARRIVAL_MS + 100);
    expect(count).toBe(1);
    advanceTo(1_700 + TOWN_ARRIVAL_MS + 100);
    expect(count).toBe(0);
    // Nothing left to expire: the clock stops ticking.
    expect(timers.size).toBe(0);

    act(() => root.unmount());
    resetTownApartmentsArrivals();
  });
}
