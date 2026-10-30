import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";

if (process.env.LAZY_FILE_PREVIEW_DOM_TEST !== "1") {
  test("the Inspector's file preview keeps its frame while its code loads", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, LAZY_FILE_PREVIEW_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  test("pending shows the name, path and Back; loaded shows the preview", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      localStorage: browser.localStorage,
      sessionStorage: browser.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    const loaded = Promise.withResolvers<void>();
    mock.module("./FilePreviewContent", async () => {
      await loaded.promise;
      return {
        FilePreviewContent: () =>
          createElement("section", { "data-loaded-preview": "" }),
      };
    });
    const { createRoot } = await import("react-dom/client");
    const { InspectorFilePreview } = await import("./LazyFilePreviewContent");
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let backs = 0;
    await act(async () =>
      root.render(
        createElement(InspectorFilePreview, {
          entry: {
            name: "notes.txt",
            path: "docs/notes.txt",
            kind: "file",
          },
          preview: null,
          loading: true,
          error: null,
          backAction: { label: "Files", onClick: () => (backs += 1) },
        } as never),
      ),
    );

    const frame = host.querySelector("section.file-preview");
    expect(frame?.getAttribute("aria-busy")).toBe("true");
    expect(frame?.querySelector(".file-preview-title")?.textContent).toBe(
      "notes.txt",
    );
    expect(frame?.querySelector(".file-preview-head span")?.textContent).toBe(
      "docs/notes.txt",
    );
    frame?.querySelector<HTMLElement>('[aria-label="Files"]')?.click();
    expect(backs).toBe(1);

    await act(async () => {
      loaded.resolve();
      await loaded.promise;
    });
    expect(host.querySelector("[data-loaded-preview]")).not.toBeNull();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => root.unmount());
  });
}
