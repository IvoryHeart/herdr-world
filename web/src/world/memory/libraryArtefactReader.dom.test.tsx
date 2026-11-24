import { expect, test } from "bun:test";

/*
 * The Library's reader shows the shelf's current record (#1327): a made
 * file deleted at its source and read again shows as deleted, without the
 * old record's contents or its Open in Files. A host whose agents have all
 * stopped (#1342) still shows what they made. Runs in its own process with
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
  const domWindow = async () => {
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
    return browser;
  };

  test("a made file deleted and read again shows as deleted in the reader", async () => {
    const browser = await domWindow();

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

  test("a host with no memory agent left shows what its gone agents made", async () => {
    const browser = await domWindow();
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { MemoryLibrary } = await import("./MemoryLibrary");
    const { setMemoryClientForTests, publishMemoryHosts, libraryHosts } =
      await import("./memoryClient");
    const { setArtefactShelfClientForTests, requestArtefactShelf } =
      await import("./artefactShelfClient");
    const { MEMORY_LIMITS } = await import("../../../../shared/memory");
    type Shelf = import("../../../../shared/agentArtefacts").ArtefactShelf;
    type Artefact = import("../../../../shared/agentArtefacts").ShelvedArtefact;

    const host = {
      connection_id: "c1",
      connection_generation: 1,
      label: "Laptop",
      names: {},
      rooms: { w1: "Project Alpha" },
      memory: false,
    };
    const made = (id: string, title: string): Artefact => ({
      id,
      title,
      kind: "report",
      where: { type: "file", path: `/srv/example/alpha/${title}` },
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
      gone_maker: "report-writer",
      gone_room: "Project Alpha",
    });
    let catalogReads = 0;
    setMemoryClientForTests({
      list: async (target: typeof host) => {
        catalogReads += 1;
        return {
          ...target,
          observed_at: 0,
          projects: [],
          agents: [],
          sources: [],
          entries: [],
          unsupported: [],
          warnings: [],
          truncated: false,
          limits: MEMORY_LIMITS,
        };
      },
      search: () => Promise.reject(new Error("memory is not searched")),
    } as unknown as import("./memoryClient").MemoryClient);
    setArtefactShelfClientForTests({
      list: async (target): Promise<Shelf> => ({
        connection_id: target.connection_id,
        connection_generation: target.connection_generation,
        observed_at: 1,
        artefacts: [
          made("artefact-report", "weekly-report.md"),
          made("artefact-plan", "launch-plan.md"),
        ],
        truncated: false,
      }),
      read: async (_target, _workspace, path) =>
        ({
          path,
          text: "Synthetic weekly report",
          truncated: false,
        }) as unknown as import("../../types").FilePreview,
    });
    publishMemoryHosts([host]);
    // Offered once its shelf is read and holds something.
    expect(libraryHosts()).toEqual([]);
    await requestArtefactShelf(host);
    expect(libraryHosts().map((one) => one.connection_id)).toEqual(["c1"]);

    const container = browser.document.createElement("div");
    browser.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    const settle = async () => {
      for (let index = 0; index < 5; index++)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    const page = browser.document.body;
    const text = () => page.textContent ?? "";
    await act(async () => {
      root.render(
        <MemoryLibrary
          request={{}}
          onClose={() => {}}
          route={{ workspace: () => "w1", openInFiles: () => null }}
        />,
      );
    });
    await settle();
    expect(catalogReads).toBe(0);
    expect(page.querySelector('[role="tablist"]')).toBeNull();
    expect(text()).toContain("only what agents made is here");
    expect(text()).toContain("weekly-report.md");
    expect(text()).toContain("report-writer (gone)");

    // Search looks through the made things alone.
    const input = page.querySelector(
      'input[aria-label="Search what agents made"]',
    ) as unknown as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )!.set!;
      setter.call(input, "launch");
      input.dispatchEvent(
        new browser.Event("input", { bubbles: true }) as never,
      );
    });
    await act(async () => {
      (
        page.querySelector('form[role="search"]') as unknown as {
          requestSubmit(): void;
        }
      ).requestSubmit();
    });
    await settle();
    expect(text()).toContain("1 found for “launch”");
    expect(
      page.querySelector('[data-artefact-id="artefact-plan"]'),
    ).not.toBeNull();
    expect(
      page.querySelector('[data-artefact-id="artefact-report"]'),
    ).toBeNull();

    // The made report reads through its room.
    await act(async () => {
      (
        page.querySelector('[data-artefact-id="artefact-plan"]') as unknown as {
          click(): void;
        }
      ).click();
    });
    await settle();
    expect(text()).toContain("Synthetic weekly report");

    // An agent that keeps memory starts there: memory is read again.
    publishMemoryHosts([{ ...host, memory: true }]);
    await settle();
    expect(catalogReads).toBe(1);
    expect(page.querySelector('[role="tablist"]')).not.toBeNull();

    await act(async () => root.unmount());
    setArtefactShelfClientForTests(null);
    setMemoryClientForTests(null);
  });
}
