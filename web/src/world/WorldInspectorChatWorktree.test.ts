import { expect, mock, test } from "bun:test";

// Issue #837: Chat stopped taking input after a few minutes. An agent that
// works on changes its worktree binding; the Inspector's hidden Files read
// then fails with "Worktree binding changed", and the re-read can report the
// evidence stale. That held the whole Inspector body inert, Chat included,
// and on Chat nothing reads the worktree again, so it stayed that way.
if (process.env.INSPECTOR_CHAT_WORKTREE_DOM_TEST !== "1") {
  test("a stale agent worktree leaves Chat usable", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, INSPECTOR_CHAT_WORKTREE_DOM_TEST: "1" },
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
  }, 20000);
} else {
  test("Chat stays live while Files re-reads a changed worktree", async () => {
    const { Window } = await import("happy-dom");
    const browser = new Window({ url: "https://world.example.test" });
    for (const key of [
      "document",
      "navigator",
      "HTMLElement",
      "HTMLDivElement",
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
        writable: true,
      });
    Object.assign(globalThis, {
      window: browser,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const {
      act,
      createElement: h,
      forwardRef,
      useContext,
      useEffect,
    } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const realStore = await import("../store");
    const realClient = await import("../useConnectionClient");
    type Observation =
      import("../../../shared/agentWorktree").AgentWorktreeObservation;
    type Client = import("../api").ConnectionClient;
    type Status = import("../api").ConnectionStatus;

    const workspace = {
      workspace_id: "workspace",
      number: 1,
      cwd: "/project/root",
      label: "Example",
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: "tab",
      agent_status: "working",
    };
    const pane = {
      pane_id: "pane",
      terminal_id: "terminal",
      workspace_id: "workspace",
      tab_id: "tab",
      agent: "claude",
      agent_status: "working",
      focused: true,
      revision: 1,
    };
    const snapshot = {
      ...realStore.store.get(),
      workspaces: [workspace],
      tabs: [
        {
          tab_id: "tab",
          workspace_id: "workspace",
          number: 1,
          label: "Example",
          focused: true,
          pane_count: 1,
          agent_status: "working",
        },
      ],
      panes: [pane],
      status: "connected" as Status,
      catalogueReady: true,
    };
    mock.module("../store", () => ({
      ...realStore,
      useStoreSelector: (selector: (value: typeof snapshot) => unknown) =>
        selector(snapshot),
    }));

    const subject = {
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      terminalId: "terminal",
      sessionFingerprint: "a".repeat(64),
    };
    // The re-read after the binding changed: the agent kept working, so the
    // service reports its evidence as changed during the read.
    let evidence: "resolved" | "stale" = "resolved";
    const observation = (): Observation =>
      evidence === "resolved"
        ? {
            subject,
            revision: "revision",
            observedAt: "2026-01-01T00:00:00Z",
            state: "resolved",
            selectedCandidateId: "root",
            candidates: [
              {
                candidateId: "root",
                canonicalRoot: "/project/root",
                gitCommonDir: "/project/root/.git",
                gitIdentity: "root",
                branch: "main",
                source: "foreground_cwd",
                evidence: {
                  sourceRef: "Synthetic observation",
                  observedAt: "2026-01-01T00:00:00Z",
                  basis: "reported",
                },
              },
            ],
          }
        : {
            subject,
            revision: "",
            observedAt: "2026-01-01T00:01:00Z",
            state: "stale",
            selectedCandidateId: null,
            candidates: [],
            reason: "Worktree evidence changed during the read.",
          };
    const calls: string[] = [];
    const base: Client = {
      connectionId: "alpha",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      acceptsServerGeneration: (value) => value === 7,
      async call(method) {
        calls.push(method);
        if (method === "agent_worktree.get") return observation();
        if (method === "file.list") {
          evidence = "stale";
          throw new Error(
            "Worktree binding changed. Refresh and choose a worktree.",
          );
        }
        return {};
      },
    };
    mock.module("../useConnectionClient", () => ({
      ...realClient,
      useConnectionClient: () => base,
    }));
    // Chat's own body is not under test: a message box stands in for it.
    mock.module("../components/AgentChat", () => ({
      AgentChat: () =>
        h("textarea", { "aria-label": "Message", className: "chat-message" }),
    }));
    mock.module("../components/AgentIcon", () => ({ AgentIcon: () => null }));
    // Files reads its listing when it mounts, even while Chat is shown.
    mock.module("../components/FileExplorerDialog", () => ({
      FileExplorerPanel: () => {
        const client = useContext(realClient.ResourceConnectionClientContext);
        useEffect(() => {
          void client
            ?.call("file.list", { workspace_id: "workspace", path: "" })
            .catch(() => undefined);
        }, [client]);
        return h("div", { className: "files-listing" });
      },
    }));
    mock.module("../components/DiffViewerPanel", () => ({
      DiffViewerPanel: forwardRef(() => null),
    }));

    const View = (await import("./WorldInspectorConversation")).default;
    const host = document.createElement("div");
    const target = document.createElement("div");
    document.body.append(host, target);
    const root = createRoot(host);
    let closes = 0;
    const props = {
      conversation: {
        nodeId: "node",
        resourceIdentity: "synthetic-resource",
        hostLabel: "Example host",
        spaceLabel: "Example space",
        connectionId: "alpha",
        runtimeGeneration: 7,
        workspaceId: "workspace",
        paneId: "pane",
        terminalId: "terminal",
        tabId: "tab",
        agentSessionFingerprint: subject.sessionFingerprint,
        view: "history" as const,
        availableViews: ["history", "files", "changes", "terminal"] as const,
        dock: "right" as const,
        size: 400,
        expanded: false,
        label: "Example",
        context: {
          kind: "agent" as const,
          label: "Example",
          agent: "claude",
          stateLabel: "Working",
          locationLabel: "Example",
        },
      },
      target,
      floating: true,
      terminalActive: false,
      onChange() {},
      onClose() {
        closes += 1;
      },
      onResourceFocus() {},
      onTerminalPortalChange() {},
      // Town's window bar: Back at the start, and Close.
      windowControls: {
        compact: false,
        maximized: false,
        onMinimize() {},
        onMaximize() {},
        onClose() {
          closes += 1;
        },
        onSnap() {},
        onFit() {},
        onFloat() {},
        back: { label: "Back to Town" },
      },
    } as unknown as Parameters<typeof View>[0];
    const settle = async () => {
      for (let turn = 0; turn < 20; turn += 1)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    const message = () =>
      document.querySelector<HTMLTextAreaElement>('[aria-label="Message"]');
    try {
      await act(async () => root.render(h(View, props)));
      await settle();
      expect(message()).not.toBeNull();
      // The hidden Files listing hit the changed binding and the re-read
      // came back stale: the same sequence as the report.
      expect(calls.filter((method) => method === "file.list").length).toBe(1);
      expect(
        calls.filter((method) => method === "agent_worktree.get").length,
      ).toBe(2);

      // Before #837's fix the message box sat in an inert body.
      expect(Boolean(message()!.closest("[inert]"))).toBe(false);
      expect(document.body.textContent).not.toContain("Disconnected");
      // Only the views that read the worktree are held.
      expect(
        document
          .querySelector(".inspector-files-resource")
          ?.hasAttribute("inert"),
      ).toBe(true);
      expect(
        document
          .querySelector(".workspace-inspector-body")
          ?.hasAttribute("inert"),
      ).toBe(false);
      const closeButtons = document.querySelectorAll<HTMLElement>(
        '[aria-label="Close Inspector window"]',
      );
      expect(closeButtons.length).toBeGreaterThan(0);
      for (const button of closeButtons) button.click();
      expect(closes).toBe(closeButtons.length);

      // Files says why it holds its last listing, not that World is offline.
      await act(async () =>
        root.render(
          h(View, {
            ...props,
            conversation: { ...props.conversation, view: "files" },
          }),
        ),
      );
      await settle();
      expect(document.body.textContent).toContain("Worktree changed");
      expect(document.body.textContent).not.toContain("Disconnected");
    } finally {
      await act(async () => root.unmount());
      await browser.happyDOM.close();
    }
  }, 15000);
}
