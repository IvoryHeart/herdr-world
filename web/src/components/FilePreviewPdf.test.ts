import { expect, mock, test } from "bun:test";

if (process.env.FILE_PREVIEW_PDF_DOM !== "1") {
  test("opening a PDF loads PDF.js only on browsers without a PDF viewer, in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, FILE_PREVIEW_PDF_DOM: "1" },
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
  }, 15000);
} else {
  for (const name of [
    "MutationObserver",
    "ResizeObserver",
    "localStorage",
    "sessionStorage",
  ] as const)
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  // PdfPages is the only module that imports PDF.js: importing it is what
  // loads PDF.js and its worker. This stand-in records that import.
  let pdfPagesImports = 0;
  mock.module(new URL("./PdfPages.tsx", import.meta.url).pathname, () => {
    pdfPagesImports += 1;
    return {
      default: ({ url }: { url: string }) =>
        createElement("div", { "data-pdf-pages": url }),
    };
  });
  const { FilePreviewContent } = await import("./FilePreviewContent");
  const { ResourceConnectionClientContext } = await import(
    "../useConnectionClient"
  );
  type Client = import("../api").ConnectionClient;
  type Props = import("react").ComponentProps<typeof FilePreviewContent>;

  let viewer = true;
  let coarse = false;
  Object.defineProperty(navigator, "pdfViewerEnabled", {
    get: () => viewer,
    configurable: true,
  });
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string) =>
    query === "(pointer: coarse)"
      ? ({ ...matchMedia(query), matches: coarse } as MediaQueryList)
      : matchMedia(query);

  const calls = mock(async () => {
    throw new Error("Unexpected file operation");
  });
  const client: Client = {
    connectionId: "host-a",
    generation: 2,
    serverRuntimeGeneration: 3,
    isCurrent: () => true,
    acceptsServerGeneration: (value) => value === 3,
    call: calls,
  };
  const pdf = (path: string): Props => ({
    entry: {
      name: path,
      path,
      type: "file",
      size: 2048,
      mtime_ms: 0,
      hidden: false,
    },
    preview: {
      workspace_id: "w1",
      checkout_path: "/example/repo",
      repo_name: "Example",
      root: "/example/repo",
      path,
      text: null,
      binary: true,
      size: 2048,
      mtime_ms: 0,
      truncated: false,
    },
    loading: false,
    error: null,
  });

  test("a PDF viewer keeps the frame; without one, opening a PDF imports PDF.js", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = (props: Props) =>
      act(async () =>
        root.render(
          createElement(
            ResourceConnectionClientContext.Provider,
            { value: client },
            createElement(FilePreviewContent, props),
          ),
        ),
      );
    const drawn = async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const pages = host.querySelector<HTMLElement>("[data-pdf-pages]");
        if (pages) return pages;
        await act(
          async () => new Promise((resolve) => setTimeout(resolve, 10)),
        );
      }
      return null;
    };
    try {
      // A desktop browser with a PDF viewer shows the PDF in a frame.
      await render(pdf("docs/first.pdf"));
      expect(host.querySelector("iframe.file-preview-pdf")).not.toBeNull();
      expect(host.querySelector("[data-pdf-pages]")).toBeNull();
      expect(pdfPagesImports).toBe(0);

      // A phone (coarse pointer) draws it with PDF.js instead.
      coarse = true;
      await render(pdf("docs/second.pdf"));
      const pages = await drawn();
      expect(pages?.dataset.pdfPages).toContain("inline=1");
      expect(pages?.dataset.pdfPages).toContain("path=docs%2Fsecond.pdf");
      expect(host.querySelector("iframe.file-preview-pdf")).toBeNull();
      expect(pdfPagesImports).toBe(1);

      // So does a desktop browser without a PDF viewer.
      coarse = false;
      viewer = false;
      await render(pdf("docs/third.pdf"));
      expect(
        (await drawn())?.dataset.pdfPages?.includes("path=docs%2Fthird.pdf"),
      ).toBe(true);
      expect(host.querySelector("iframe.file-preview-pdf")).toBeNull();
      expect(calls).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
}
