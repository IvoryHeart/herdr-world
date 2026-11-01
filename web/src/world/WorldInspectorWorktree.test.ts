import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, type ComponentProps } from "react";
import type { AgentWorktreeObservation } from "../../../shared/agentWorktree";
import type { ConnectionClient, ConnectionStatus } from "../api";
import type { FilePreview, Pane, Workspace } from "../types";

if (process.env.INSPECTOR_WORKTREE_DOM_TEST !== "1") {
  test("the actual Inspector retires resources across same-path worktree replacement", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, INSPECTOR_WORKTREE_DOM_TEST: "1" },
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
  }, 15000);
} else {
  test("binding changes retire delayed and retained previews without changing saved path preferences", async () => {
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
    const { createRoot } = await import("react-dom/client");
    const realStore = await import("../store");
    const realClient = await import("../useConnectionClient");
    const workspace: Workspace = {
      workspace_id: "workspace",
      number: 1,
      cwd: "/project/root",
      label: "Example",
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: "tab",
      agent_status: "idle",
    };
    const pane: Pane = {
      pane_id: "pane",
      terminal_id: "terminal",
      workspace_id: "workspace",
      tab_id: "tab",
      agent: "codex",
      agent_status: "idle",
      focused: true,
      revision: 1,
    };
    const snapshot = {
      ...realStore.store.get(),
      workspaces: [workspace],
      panes: [pane],
      status: "connected" as ConnectionStatus,
      catalogueReady: true,
    };
    mock.module("../store", () => ({
      ...realStore,
      useStoreSelector: (selector: (value: typeof snapshot) => unknown) =>
        selector(snapshot),
    }));
    let identity = "old-root";
    let revision = "old-revision";
    const subject = {
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      terminalId: "terminal",
      sessionFingerprint: "a".repeat(64),
    };
    const observation = (): AgentWorktreeObservation => ({
      subject,
      revision,
      observedAt: "2026-01-01T00:00:00Z",
      state: "resolved",
      selectedCandidateId: identity,
      candidates: [
        {
          candidateId: identity,
          canonicalRoot: "/project/root",
          gitCommonDir: "/project/root/.git",
          gitIdentity: identity,
          branch: "main",
          source: "foreground_cwd",
          evidence: {
            sourceRef: "Synthetic observation",
            observedAt: "2026-01-01T00:00:00Z",
            basis: "reported",
          },
        },
      ],
    });
    const pending = Promise.withResolvers<FilePreview>();
    let reads = 0;
    const preview = (text: string): FilePreview => ({
      workspace_id: "workspace",
      root: "/project/root",
      checkout_path: "/project/root",
      path: "same.txt",
      text,
      size: text.length,
      mtime_ms: 1,
      binary: false,
      truncated: false,
    });
    let online = true;
    const base: ConnectionClient = {
      connectionId: "alpha",
      generation: 1,
      serverRuntimeGeneration: 7,
      isCurrent: () => online,
      acceptsServerGeneration: (value) => value === 7,
      async call(method) {
        if (method === "agent_worktree.get") return observation();
        if (method === "file.read")
          return ++reads === 1 ? pending.promise : preview("NEW ROOT CONTENT");
        return {};
      },
    };
    mock.module("../useConnectionClient", () => ({
      ...realClient,
      useConnectionClient: () => base,
    }));
    type InspectorProps = ComponentProps<
      typeof import("../components/WorkspaceInspectorHost").WorkspaceInspectorHost
    >;
    let shown!: InspectorProps;
    // The Inspector's code loads lazily; hold it back to see the window
    // while it downloads.
    const hostLoaded = Promise.withResolvers<void>();
    mock.module("../components/WorkspaceInspectorHost", async () => {
      await hostLoaded.promise;
      return {
        WorkspaceInspectorHost: (props: InspectorProps) => {
          shown = props;
          return createElement("div");
        },
      };
    });
    let closes = 0;
    const View = (await import("./WorldInspectorConversation")).default;
    const host = document.createElement("div");
    document.body.append(host);
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(host);
    const props: ComponentProps<typeof View> = {
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
        view: "files",
        availableViews: ["files", "changes", "terminal"],
        dock: "right",
        size: 400,
        expanded: false,
        label: "Example",
        context: {
          kind: "agent",
          label: "Example",
          stateLabel: "Idle",
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
    };
    try {
      await act(async () => root.render(createElement(View, props)));
      // The shell is the Inspector's own frame and bar, so World's window,
      // Town and phone styles apply before and after the code arrives.
      const shell = document.querySelector(
        'aside.workspace-inspector.workspace-inspector-right[aria-busy="true"]',
      );
      expect(
        shell?.querySelector(":scope > header.workspace-inspector-head"),
      ).not.toBeNull();
      expect(
        shell?.querySelector(
          ".workspace-inspector-identity > .workspace-inspector-repo",
        )?.textContent,
      ).toBe("Example");
      shell
        ?.querySelector<HTMLElement>('[aria-label="Close Workspace Inspector"]')
        ?.click();
      expect(closes).toBe(1);
      await act(async () => {
        hostLoaded.resolve();
        await hostLoaded.promise;
      });
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(shown.agentWorktree?.target?.candidateId).toBe("old-root");
      await act(async () => shown.onSelectFileTab("same.txt"));
      expect(shown.fileSelection.loading).toBe(true);
      const oldProps = shown;
      const savedScope = shown.state.scope;
      const oldRequestId = shown.previewRequestRef.current;
      identity = "replacement-root";
      revision = "replacement-revision";
      await act(async () => shown.agentWorktree!.refresh());
      expect(shown.state.scope).toEqual(savedScope);
      expect(shown.connectionClient.agentWorktree?.candidateId).toBe(identity);
      expect(shown.previewRequestRef.current).toBeGreaterThan(oldRequestId);
      expect(reads).toBe(2);
      expect(shown.fileSelection.preview?.text).toBe("NEW ROOT CONTENT");
      expect(oldProps.connectionClient.isCurrent()).toBe(true);
      await expect(
        oldProps.connectionClient.call("file.read", { path: "same.txt" }),
      ).rejects.toThrow("Worktree");
      await act(async () => pending.resolve(preview("OLD ROOT CONTENT")));
      expect(shown.fileSelection.preview?.text).not.toBe("OLD ROOT CONTENT");
      await act(async () => shown.onSelectFileTab("same.txt"));
      expect(shown.fileSelection.preview?.text).toBe("NEW ROOT CONTENT");
      const offlinePreview = shown.fileSelection.preview;
      const offlineScope = shown.state.scope;
      online = false;
      snapshot.status = "disconnected";
      snapshot.catalogueReady = false;
      await act(async () => root.render(createElement(View, { ...props })));
      expect(shown.presentationStale).toBe(true);
      expect(shown.fileSelection.preview).toBe(offlinePreview);
      expect(shown.state.scope).toEqual(offlineScope);
      online = true;
      snapshot.status = "connected";
      snapshot.catalogueReady = true;
      await act(async () => root.render(createElement(View, { ...props })));
      expect(shown.presentationStale).toBe(false);
      expect(shown.fileSelection.preview).toBe(offlinePreview);
      const retained = shown;
      await act(async () =>
        shown.onDiffSelectionChange?.({
          ...shown.diffSelection,
          entry: {
            path: "same.txt",
            kind: "unstaged",
            status: "modified",
            additions: 1,
            deletions: 0,
          },
        }),
      );
      const retainedPreview = shown.fileSelection.preview;
      const retainedReads = reads;
      revision = "new-observation-same-candidate";
      await act(async () => shown.agentWorktree!.refresh());
      expect(reads).toBe(retainedReads + 1);
      expect(shown.fileSelection.preview).not.toBe(retainedPreview);
      expect(shown.diffSelection.entry).toBeNull();
      await act(async () =>
        retained.onDiffSelectionChange?.({
          ...retained.diffSelection,
          error: "OLD ROOT ERROR",
        }),
      );
      expect(shown.diffSelection.error).not.toBe("OLD ROOT ERROR");
      identity = "old-root";
      revision = "old-revision";
      await act(async () => shown.agentWorktree!.refresh());
      await act(async () =>
        oldProps.onDiffSelectionChange?.({
          ...oldProps.diffSelection,
          error: "RETIRED SELECTION ERROR",
        }),
      );
      expect(shown.diffSelection.error).not.toBe("RETIRED SELECTION ERROR");
    } finally {
      await act(async () => root.unmount());
      await browser.happyDOM.close();
    }
  });
}
