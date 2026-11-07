import { expect, test } from "bun:test";

// Run each renderer in a fresh process, away from component tests' React mocks.
const renderer = process.env.WORLD_REACT_TRACKS_RENDERER;
if (!renderer) {
  test.each(["client", "profiling"])(
    "%s development changed-prop diagnostics bound object-array traversal",
    async (entry) => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, WORLD_REACT_TRACKS_RENDERER: entry },
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
    },
  );
} else {
  test("large changed object arrays retain diagnostics without walking every item", async () => {
    const { Window } = await import("happy-dom");
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });

    const measures: { name: string; properties: [string, string][] }[] = [];
    const measure = performance.measure;
    performance.measure = ((name, options) => {
      const properties = (options as any)?.detail?.devtools?.properties;
      if (properties)
        measures.push({ name, properties: structuredClone(properties) });
      return measure.call(
        performance,
        name,
        options as PerformanceMeasureOptions,
      );
    }) as typeof performance.measure;

    const { act, createElement: h } = await import("react");
    // The profiling entry exposes the same client API but ships no declaration.
    const { createRoot } = (await import(
      `react-dom/${renderer}`
    )) as typeof import("react-dom/client");
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let reads = 0;
    const rows = (label: string) =>
      Array.from({ length: 1000 }, () => ({
        get label() {
          reads++;
          return label;
        },
      }));
    function DiagnosticRows({
      rows,
      label,
    }: {
      rows: object[];
      label: string;
    }) {
      return h("span", {}, `${label}: ${rows.length}`);
    }
    try {
      await act(async () =>
        root.render(h(DiagnosticRows, { rows: rows("old"), label: "old" })),
      );
      reads = 0;
      measures.length = 0;
      await act(async () =>
        root.render(h(DiagnosticRows, { rows: rows("new"), label: "new" })),
      );
      expect(host.textContent).toBe("new: 1000");
      const diagnostic = measures.find((entry) =>
        entry.name.includes("DiagnosticRows"),
      );
      expect(diagnostic).toBeDefined();
      expect(
        diagnostic!.properties.some(([key]) => key.includes("label")),
      ).toBe(true);
      expect(
        diagnostic!.properties.some(([key]) =>
          key.includes("too many properties"),
        ),
      ).toBe(true);
      expect(reads).toBeGreaterThan(0);
      expect(reads).toBeLessThan(500);
    } finally {
      await act(async () => root.unmount());
      performance.measure = measure;
      await browser.happyDOM.close();
    }
  });
}
