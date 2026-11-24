import { expect, test } from "bun:test";

/*
 * The Library's reader shows the shelf's current record (#1327): a made
 * file deleted at its source and read again shows as deleted, without the
 * old record's contents or its Open in Files. Runs in its own process with
 * happy-dom, so its globals never reach other tests.
 */
if (process.env.HERDR_WORLD_LIBRARY_DOM_TEST !== "1") {
  test("the Library's reader follows the current record", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_LIBRARY_DOM_TEST: "1" },
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
  }, 20_000);
} else {
  test("a made file deleted and read again shows as deleted in the reader", async () => {
    const { Window } = await import("happy-dom");
    const browser = new Window({ url: "http://localhost/" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      DOMParser: browser.DOMParser,
      NodeFilter: browser.NodeFilter,
      localStorage: browser.localStorage,
      sessionStorage: browser.sessionStorage,
      Event: browser.Event,
      MouseEvent: browser.MouseEvent,
      KeyboardEvent: browser.KeyboardEvent,
      CustomEvent: browser.CustomEvent,
      MutationObserver: browser.MutationObserver,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true });

    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { MemoryLibrary } = await import("./MemoryLibrary");
    const { setMemoryClientForTests, publishMemoryHosts } = await import(
      "./memoryClient"
    );
    const { setArtefactShelfClientForTests } = await import(
      "./artefactShelfClient"
    );
    const { MEMORY_LIMITS } = await import("../../../../shared/memory");
    type Shelf = import("../../../../shared/agentArtefacts").ArtefactShelf;
    type Artefact = import("../../../../shared/agentArtefacts").ShelvedArtefact;

    const host = {
      connection_id: "c1",
      connection_generation: 1,
      label: "Laptop",
      names: { p1: "builder" },
      rooms: { w1: "Project Alpha" },
    };
    const report: Artefact = {
      id: "artefact-report",
      title: "weekly-notes.txt",
      kind: "report",
      where: { type: "file", path: "/srv/example/alpha/weekly-notes.txt" },
      made_at: "2026-11-20T09:00:00.000Z",
      evidence: "file_write",
      exists: true,
      made_by: {
        connection_id: "c1",
        pane_id: "p1",
        agent: "claude",
        workspace_id: "w1",
        session: null,
      },
      gone_maker: null,
      gone_room: null,
    };
    let exists = true;
    let lists = 0;
    setMemoryClientForTests({
      list: async (target: typeof host) => ({
        ...target,
        observed_at: 0,
        projects: [
          { id: "w1", label: "Project Alpha", path: "/srv/example/alpha" },
        ],
        agents: [],
        sources: [],
        entries: [],
        unsupported: [],
        warnings: [],
        truncated: false,
        limits: MEMORY_LIMITS,
      }),
      search: () => Promise.reject(new Error("unused")),
      read: () => Promise.reject(new Error("unused")),
      create: () => Promise.reject(new Error("unused")),
      update: () => Promise.reject(new Error("unused")),
    } as unknown as import("./memoryClient").MemoryClient);
    setArtefactShelfClientForTests({
      list: async (target): Promise<Shelf> => {
        lists += 1;
        return {
          connection_id: target.connection_id,
          connection_generation: target.connection_generation,
          observed_at: lists,
          artefacts: [{ ...report, exists }],
          truncated: false,
        };
      },
      read: async (_target, _workspace, path) =>
        ({
          path,
          text: "Synthetic weekly notes",
          truncated: false,
        }) as unknown as import("../../types").FilePreview,
    });
    publishMemoryHosts([host]);

    const container = browser.document.createElement("div");
    browser.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    const settle = async () => {
      for (let index = 0; index < 5; index++)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    // The Library is a dialog: it renders into the page, not the container.
    const page = browser.document.body;
    const text = () => page.textContent ?? "";
    await act(async () => {
      root.render(
        <MemoryLibrary
          request={{ connectionId: "c1", wing: "artefacts" }}
          onClose={() => {}}
          route={{
            workspace: () => "w1",
            openInFiles: () => () => {},
          }}
        />,
      );
    });
    await settle();
    const click = async (selector: string) => {
      const target = page.querySelector(selector) as unknown as {
        click(): void;
      } | null;
      if (!target) throw new Error(`No ${selector} in the Library`);
      await act(async () => target.click());
    };
    await click('[data-artefact-id="artefact-report"]');
    await settle();
    expect(text()).toContain("Synthetic weekly notes");
    expect(text()).toContain("Open in Files");

    // The file is deleted at its source; the person reads the host again.
    exists = false;
    await click('button[aria-label="Read again"]');
    await settle();
    expect(lists).toBeGreaterThanOrEqual(2);
    expect(text()).toContain("This file was deleted.");
    expect(text()).not.toContain("Synthetic weekly notes");
    expect(text()).not.toContain("Open in Files");

    await act(async () => root.unmount());
    setArtefactShelfClientForTests(null);
    setMemoryClientForTests(null);
  });
}
