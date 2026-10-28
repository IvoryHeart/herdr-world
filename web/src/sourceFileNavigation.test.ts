import { expect, mock, test } from "bun:test";

test("Chat source links navigate through the admitted Inspector binding", async () => {
  if (process.env.SOURCE_FILE_DOM_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SOURCE_FILE_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
    return;
  }
  const { Window } = await import("happy-dom");
  const browser = new Window({ url: "https://world.example.test" });
  for (const key of [
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "NodeFilter",
    "DOMParser",
    "MouseEvent",
    "localStorage",
    "sessionStorage",
    "ResizeObserver",
    "MutationObserver",
    "CustomEvent",
  ])
    Object.defineProperty(globalThis, key, {
      value: Reflect.get(browser, key),
      configurable: true,
    });
  Object.assign(globalThis, {
    window: browser,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const {
    createElement: h,
    act,
    useContext,
    forwardRef,
  } = await import("react");
  const { SourceFileLinkContext } = await import("./sourceFileLinks");
  const { createRoot } = await import("react-dom/client");
  const { MarkdownPreview } = await import("./components/markdown");
  const { InspectorSourceFiles } = await import(
    "./components/InspectorSourceFiles"
  );
  const { agentWorktreeClient } = await import("./agentWorktreeClient");
  type Selection =
    import("./components/FilePreviewContent").ActiveFilePreviewSelection;
  type View = import("./useAgentWorktree").AgentWorktreeView;
  const target = {
    subject: {
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      sessionFingerprint: "session",
    },
    candidateId: "root",
    revision: "r1",
  };
  const selected = {
    candidateId: "root",
    canonicalRoot: "/project/demo",
    gitCommonDir: "/project/demo/.git",
    branch: "topic",
    source: "session_cwd" as const,
    evidence: {
      sourceRef: "Synthetic",
      observedAt: "2026-01-01T00:00:00Z",
      basis: "reported" as const,
    },
  };
  let online = true;
  let pending: ReturnType<
    typeof Promise.withResolvers<import("./types").FilePreview>
  > | null = null;
  const calls: Record<string, unknown>[] = [];
  const base: import("./api").ConnectionClient = {
    connectionId: "alpha",
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => online,
    acceptsServerGeneration: (value) => value === 7,
    async call(method, params) {
      calls.push({ method, ...params });
      return pending
        ? pending.promise
        : {
            workspace_id: "workspace",
            path: params?.path,
            root: "/project/demo",
            text: "line one\nline two",
            size: 17,
            mtime_ms: 0,
            binary: false,
            truncated: false,
          };
    },
  };
  let view: View = {
    selected,
    target,
    observation: null,
    loading: false,
    refresh() {},
    select() {},
  };
  let client = agentWorktreeClient(base, target);
  let selection: Selection | null = null;
  let opens = 0,
    chooses = 0;
  const previewRequestRef = { current: 0 };
  let navigate: ((href: string) => void) | null = null;
  function Probe() {
    navigate = useContext(SourceFileLinkContext);
    return null;
  }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const render = async () =>
    act(async () =>
      root.render(
        h(InspectorSourceFiles, {
          source: {
            client,
            worktree: view,
            paneId: "pane",
            sessionFingerprint: "session",
            workspaceId: "workspace",
            previewRequestRef,
            onSelection: (value) => {
              selection = value;
            },
            onOpen: () => {
              opens++;
            },
            onChoose: () => {
              chooses++;
            },
          },
          children: [
            h(Probe, { key: "probe" }),
            h(MarkdownPreview, {
              key: "markdown",
              text: "[source](/project/demo/src/main.ts:12) [relative](src/other.ts#L2) [outside](/project/other/main.ts:8) [web](https://example.test/guide) [bare](main.ts:9) [drive](C:/project/demo/main.ts:9) [unsafe](javascript:alert(1)) [remote](file://other.example.test/project/demo/main.ts)\n\n`/project/demo/src/inline.ts:3`\n\n/project/demo/src/plain.ts:4\n\n`main.ts:12` and README.md, root.ts:9 and `/project/demo/src/a b.ts:12`. [escaped](src/C%23.ts#L12). HTTP/1.1 and 3.12/3.13 stay prose.\n\n```\n/project/demo/do-not-link.ts:5\n```",
            }),
          ],
        }),
      ),
    );
  const click = async (text: string) => {
    const anchor = [...node.querySelectorAll("a")].find(
      (item) => item.textContent === text,
    )!;
    expect(anchor).toBeDefined();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      anchor.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  };
  try {
    await render();
    await click("source");
    expect(opens).toBe(1);
    expect(selection).toMatchObject({
      entry: { path: "src/main.ts" },
      line: 12,
      loading: false,
    });
    expect(calls[0]).toMatchObject({
      method: "file.read",
      workspace_id: "workspace",
      path: "src/main.ts",
      agent_worktree: target,
    });
    await click("relative");
    expect(selection).toMatchObject({
      line: 2,
      entry: { path: "src/other.ts" },
    });
    await click("/project/demo/src/inline.ts:3");
    expect(selection).toMatchObject({
      line: 3,
      entry: { path: "src/inline.ts" },
    });
    await click("/project/demo/src/plain.ts:4");
    expect(selection).toMatchObject({
      line: 4,
      entry: { path: "src/plain.ts" },
    });
    expect(node.querySelector("pre a")).toBeNull();
    await click("bare");
    expect(selection).toMatchObject({ line: 9, entry: { path: "main.ts" } });
    for (const [label, path, line] of [
      ["main.ts:12", "main.ts", 12],
      ["README.md", "README.md", undefined],
      ["root.ts:9", "root.ts", 9],
      ["/project/demo/src/a b.ts:12", "src/a b.ts", 12],
      ["escaped", "src/C#.ts", 12],
    ] as const) {
      await click(label);
      expect(selection).toMatchObject({ entry: { path }, line });
    }
    for (const prose of ["HTTP/1.1", "3.12/3.13"]) {
      expect(
        [...node.querySelectorAll("[data-source-file]")].some(
          (a) => a.textContent === prose,
        ),
      ).toBe(false);
    }
    for (const label of ["unsafe", "remote"]) {
      expect(
        [...node.querySelectorAll("a")]
          .find((a) => a.textContent === label)
          ?.hasAttribute("href"),
      ).toBe(false);
    }
    const web = [...node.querySelectorAll("a")].find(
      (a) => a.textContent === "web",
    )!;
    expect(web.getAttribute("href")).toBe("https://example.test/guide");
    expect(web.getAttribute("target")).toBe("_blank");
    const before = calls.length;
    await click("outside");
    expect(node.querySelector("[role=alert]")?.textContent).toContain(
      "outside the selected worktree",
    );
    expect(calls.length).toBe(before);
    await act(async () =>
      node.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(chooses).toBe(1);
    view = { ...view, target: null };
    await render();
    expect(node.querySelector("[role=alert]")).toBeNull();
    await click("source");
    expect(node.textContent).toContain("Choose a current agent worktree");
    expect(calls.length).toBe(before);
    for (const mismatch of [
      { connectionId: "beta" },
      { generation: 8 },
      { paneId: "other" },
      { sessionFingerprint: "other" },
    ]) {
      view = {
        ...view,
        target: { ...target, subject: { ...target.subject, ...mismatch } },
      };
      await render();
      await click("source");
      expect(node.textContent).toContain("unavailable for the current agent");
      expect(calls.length).toBe(before);
    }
    view = { ...view, target };
    await render();
    online = false;
    await click("source");
    expect(calls.length).toBe(before);
    online = true;
    client = agentWorktreeClient({ ...base, generation: 2 }, target);
    await render();
    expect(node.querySelector("[role=alert]")).toBeNull();
    pending = Promise.withResolvers();
    await click("source");
    const equivalentRead = pending;
    view = {
      ...view,
      target: structuredClone(view.target),
      selected: structuredClone(view.selected),
      observation: structuredClone(view.observation),
    };
    client = agentWorktreeClient(
      { ...base, generation: 2 },
      structuredClone(target),
    );
    await render();
    await act(async () =>
      equivalentRead.resolve({
        workspace_id: "workspace",
        root: "/project/demo",
        checkout_path: "/project/demo",
        path: "src/main.ts",
        text: "CURRENT ROOT CONTENT",
        size: 20,
        mtime_ms: 0,
        binary: false,
        truncated: false,
      }),
    );
    expect(selection).toMatchObject({
      loading: false,
      line: 12,
      preview: { text: "CURRENT ROOT CONTENT" },
    });
    pending = Promise.withResolvers();
    await click("source");
    expect(selection).toMatchObject({ loading: true });
    const retired = navigate as ((href: string) => void) | null;
    const replacement = {
      ...target,
      revision: "r2",
      candidateId: "replacement",
    };
    view = {
      ...view,
      target: replacement,
      selected: { ...selected, candidateId: "replacement" },
    };
    client = agentWorktreeClient(base, replacement);
    await render();
    await act(async () =>
      pending!.resolve({
        workspace_id: "workspace",
        path: "src/main.ts",
        root: "/project/demo",
        checkout_path: "/project/demo",
        text: "OLD ROOT CONTENT",
        size: 16,
        mtime_ms: 0,
        binary: false,
        truncated: false,
      }),
    );
    expect((selection as Selection | null)?.preview?.text).not.toBe(
      "OLD ROOT CONTENT",
    );
    const afterReplacement = calls.length;
    await act(async () => retired?.("/project/demo/src/main.ts:12"));
    expect(calls.length).toBe(afterReplacement);
    mock.module("./components/AgentChat", () => ({
      AgentChat: () =>
        h(
          "div",
          null,
          h(Probe),
          h(MarkdownPreview, {
            text: "[source](/project/demo/src/main.ts:12)",
          }),
        ),
    }));
    const { InspectorChat } = await import("./components/InspectorChat");
    await act(async () =>
      root.render(
        h(InspectorChat, {
          pane: {
            pane_id: "pane",
            terminal_id: "terminal",
            workspace_id: "workspace",
            tab_id: "tab",
            focused: true,
            agent: "claude",
            agent_status: "idle",
            revision: 1,
          },
          active: false,
          onClose() {},
          sourceFiles: {
            client,
            worktree: undefined,
            paneId: "pane",
            workspaceId: "workspace",
            previewRequestRef,
            onOpen() {
              throw new Error(
                "Spaces must not open source Files without a worktree",
              );
            },
            onChoose() {
              throw new Error("Spaces has no agent-worktree chooser");
            },
          },
        }),
      ),
    );
    expect(navigate).toBeNull();
    expect(node.querySelector("a")?.getAttribute("href")).toBe(
      "/project/demo/src/main.ts:12",
    );
    expect(node.querySelector("[data-source-file]")).toBeNull();
    expect(node.querySelector("[role=alert]")).toBeNull();
    mock.module("./components/AgentIcon", () => ({ AgentIcon: () => null }));
    mock.module("./components/FileExplorerDialog", () => ({
      FileExplorerPanel: () => null,
    }));
    mock.module("./components/DiffViewerPanel", () => ({
      DiffViewerPanel: forwardRef(() => null),
    }));
    const { WorkspaceInspectorHost } = await import(
      "./components/WorkspaceInspectorHost"
    );
    const empty = { entry: null, preview: null, loading: false, error: null };
    const noop = () => {};
    await act(async () =>
      root.render(
        h(WorkspaceInspectorHost, {
          state: {
            scope: {
              kind: "workspace",
              connectionId: "alpha",
              workspaceId: "workspace",
            },
            open: true,
            view: "history",
            dock: "right",
            size: 520,
            expanded: false,
          },
          visible: true,
          workspace: {
            workspace_id: "workspace",
            number: 1,
            label: "Example",
            focused: true,
            pane_count: 1,
            tab_count: 1,
            agent_status: "idle",
          },
          historyPane: {
            pane_id: "pane",
            terminal_id: "terminal",
            workspace_id: "workspace",
            tab_id: "tab",
            focused: true,
            agent: "claude",
            agent_status: "idle",
            revision: 1,
          },
          fileSelection: empty,
          previewRequestRef,
          diffSelection: {
            entry: null,
            file: null,
            loading: false,
            error: null,
            entries: [],
            files: {},
            fileErrors: {},
            summaryLoading: false,
          },
          connectionClient: { ...base, isCurrent: () => false },
          annotations: [],
          onSelectFileTab: noop,
          onFileSelectionChange: noop,
          onDiffSelectionChange: noop,
          onOpenDocument: noop,
          onRefreshFile: noop,
          onOpenDiffFile: noop,
          onCreateAnnotation: noop,
          onReanchorFileAnnotations: noop,
          onReanchorDiffAnnotations: noop,
          onEditAnnotation: noop,
          onViewChange: noop,
          onDockChange: noop,
          onExpandedChange: noop,
          onClose: noop,
          onBack: noop,
        }),
      ),
    );
    expect(
      node.querySelector(".inspector-history-resource a")?.getAttribute("href"),
    ).toBe("/project/demo/src/main.ts:12");
    expect(
      node.querySelector(".inspector-history-resource [data-source-file]"),
    ).toBeNull();
    expect(navigate).toBeNull();
    expect(node.querySelector(".agent-worktree-picker")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
  }
}, 15000);
