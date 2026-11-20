import { expect, test } from "bun:test";

if (process.env.QUESTION_BACKLOG_DOM !== "1") {
  test("question backlog actions in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, QUESTION_BACKLOG_DOM: "1" },
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
  }, 30000);
} else {
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { NeedsYouAskerActions } = await import("./NeedsYouAskerActions");
  const { createQuestionBacklogFixture } = await import(
    "../testing/QuestionBacklogFixture"
  );
  const { useWorldAsks } = await import("./worldAsks");

  test("one click closes the whole backlog across generations and pages, leaving the other asker", async () => {
    const fixture = createQuestionBacklogFixture(31);
    function View() {
      const asks = useWorldAsks(fixture.store);
      return h(
        "div",
        null,
        h("span", null, `${asks.length} waiting`),
        h(NeedsYouAskerActions, { asks, store: fixture.store }),
      );
    }
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(h(View));
    });
    expect(host.textContent).toContain("Dismiss all 31 questions from Atlas");
    fixture.fail(true);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Synthetic save failure",
    );
    expect(fixture.store.get()).toHaveLength(32);
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
    fixture.fail(false);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.textContent).toContain("1 waiting");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.store.get()[0]?.actor.name).toBe("Beacon");
    expect(
      fixture.calls.filter((call) => call.method === "world.ask.dismiss"),
    ).toEqual([
      {
        method: "world.ask.dismiss",
        params: { id: "q-fixture-0", all_from_asker: true },
      },
      {
        method: "world.ask.dismiss",
        params: { id: "q-fixture-0", all_from_asker: true },
      },
    ]);
    await act(async () => root.unmount());
    host.remove();
  });

  test("matching names and unverified terminal claims never combine askers", async () => {
    const fixture = createQuestionBacklogFixture(1);
    await fixture.store.refresh();
    const base = fixture.store.get()[0]!;
    const asks = [
      base,
      {
        ...base,
        id: "q-other",
        actor: { ...base.actor, terminal_id: "other" },
      },
      ...["a", "b"].map((id) => ({
        ...base,
        id,
        actor: { ...base.actor, verified: false },
      })),
    ];
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () =>
      root.render(h(NeedsYouAskerActions, { asks, store: fixture.store })),
    );
    expect(host.querySelector("button")).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
}
