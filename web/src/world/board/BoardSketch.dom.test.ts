import { expect, test } from "bun:test";

if (process.env.BOARD_SKETCH_DOM !== "1") {
  test("Board text conflicts preserve every editor's draft", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, BOARD_SKETCH_DOM: "1" },
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
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    MouseEvent: browser.MouseEvent,
    KeyboardEvent: browser.KeyboardEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement: h, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useBoardSketch } = await import("./BoardSketch");
  const { useBoardDocument } = await import("./boardDocument");
  const { createBoardTextFixture } = await import(
    "../testing/BoardTextConflictFixture"
  );

  async function mount(kind: "text" | "rect" = "text") {
    const fixture = createBoardTextFixture(kind);
    await fixture.store.refresh();
    const notices: string[] = [];
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "board";
    const root = createRoot(host);
    function Sketch() {
      const { document } = useBoardDocument(fixture.store);
      return useBoardSketch({
        store: fixture.store,
        shapes: document?.shapes ?? [],
        host: {
          scale: () => 1,
          toWorld: (x, y) => ({ x, y }),
          targetBox: () => null,
          cardAt: () => null,
          note() {},
          selected() {},
          notify: (text) => notices.push(text),
        },
      }).layer;
    }
    await act(async () => root.render(h(StrictMode, null, h(Sketch))));
    const editor = () => host.querySelector<HTMLTextAreaElement>("textarea");
    return {
      ...fixture,
      notices,
      editor,
      async edit(id: string) {
        await act(async () => {
          host
            .querySelector(`[data-hit="${id}"]`)!
            .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
      },
      async type(text: string) {
        await act(async () => {
          const input = editor()!;
          Object.getOwnPropertyDescriptor(
            browser.HTMLTextAreaElement.prototype,
            "value",
          )!.set!.call(input, text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      },
      async finish() {
        await act(async () => editor()!.blur());
      },
      async save() {
        await act(async () =>
          editor()!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              ctrlKey: true,
              bubbles: true,
            }),
          ),
        );
      },
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  for (const kind of ["text", "rect"] as const)
    for (const settle of ["before B", "during B", "after B"] as const)
      test(`${kind}: A's refusal ${settle} keeps both drafts`, async () => {
        const board = await mount(kind);
        try {
          await board.edit("a");
          await board.type("Draft A");
          await act(async () => board.otherClient("a", { x: 140 }));
          const release = board.hold();
          await board.finish();
          if (settle === "before B") await act(async () => release());
          // A may already have reopened; a real double-click blurs it first.
          if (board.editor()) await board.finish();
          await board.edit("b");
          await board.type("Draft B");
          if (settle === "during B") await act(async () => release());
          expect(board.editor()?.value).toBe("Draft B");
          await board.finish();
          if (settle === "after B") await act(async () => release());
          if (settle !== "before B") {
            expect(board.editor()?.value).toBe("Draft A");
            expect(board.saved().shapes!.find((s) => s.id === "a")!.text).toBe(
              "Other client A",
            );
            await board.finish();
          }
          expect(board.editor()).toBeNull();
          expect(board.saved().shapes!.map((s) => s.text)).toEqual([
            "Draft A",
            "Draft B",
          ]);
          expect(board.saved().shapes![0]!.x).toBe(140);
          expect(board.saved().shapes![0]!.color).toBe("teal");
          expect(board.notices).toContain("That drawing changed elsewhere.");
          expect(board.writes[0]![0]).toMatchObject({
            op: "shape.put",
            rev: 1,
          });
        } finally {
          await board.close();
        }
      });

  test("two refused drafts reopen in turn without replacing the active editor", async () => {
    const board = await mount();
    try {
      await board.edit("a");
      await board.type("Draft A");
      await act(async () => board.otherClient("a"));
      const release = board.hold();
      // Double-clicking B must finish A even if the pointer prevented blur.
      await board.edit("b");
      await board.type("Draft B");
      await act(async () => board.otherClient("b"));
      await act(async () => release());
      expect(board.editor()?.value).toBe("Draft B");
      await board.save();
      expect(board.editor()?.value).toBe("Draft A");
      await board.save();
      expect(board.editor()?.value).toBe("Draft B");
      await board.save();
      expect(board.editor()).toBeNull();
      expect(board.saved().shapes!.map((s) => s.text)).toEqual([
        "Draft A",
        "Draft B",
      ]);
      expect(board.notices).toHaveLength(2);
    } finally {
      await board.close();
    }
  });

  test("two sessions for the same drawing have separate text and completion state", async () => {
    const board = await mount();
    try {
      await board.edit("a");
      await board.type("First draft");
      await act(async () => board.otherClient("a"));
      const release = board.hold();
      await board.finish();
      await board.edit("a");
      await board.type("Second draft");
      await act(async () => release());
      expect(board.editor()?.value).toBe("Second draft");
      await board.save();
      expect(board.editor()?.value).toBe("First draft");
      expect(board.saved().shapes![0]!.text).toBe("Other client A");
      await board.save();
      expect(board.editor()?.value).toBe("Second draft");
      expect(board.saved().shapes![0]!.text).toBe("First draft");
      // A recovery can itself become stale while waiting. Refusing it again
      // must remount the same drawing with a fresh completion flag.
      await board.save();
      expect(board.editor()?.value).toBe("Second draft");
      expect(board.saved().shapes![0]!.text).toBe("First draft");
      await board.save();
      expect(board.editor()).toBeNull();
      expect(board.saved().shapes![0]!.text).toBe("Second draft");
      expect(board.notices).toHaveLength(3);
    } finally {
      await board.close();
    }
  });

  test("refused deletion from clearing A's text also waits behind B", async () => {
    const board = await mount();
    try {
      await board.edit("a");
      await board.type("");
      await act(async () => board.otherClient("a"));
      const release = board.hold();
      await board.finish();
      await board.edit("b");
      await board.type("Draft B");
      await act(async () => release());
      expect(board.editor()?.value).toBe("Draft B");
      await board.save();
      expect(board.editor()?.value).toBe("");
      expect(board.saved().shapes![0]!.text).toBe("Other client A");
      await board.save();
      expect(board.editor()).toBeNull();
      expect(board.saved().shapes!.map((s) => s.text)).toEqual(["Draft B"]);
    } finally {
      await board.close();
    }
  });
}
