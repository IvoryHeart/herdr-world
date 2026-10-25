import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { AgentWorktreeObservation } from "../../../shared/agentWorktree";
import type { ConnectionClient } from "../api";

if (process.env.WORLD_RESOURCE_RESUME_DOM_TEST !== "1") {
  test("real Inspector resource children retain their tree through delayed readmission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_RESOURCE_RESUME_DOM_TEST: "1" },
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
  }, 15000);
} else {
  test("actual Files, Changes and gate preserve presentation while resource authority is retired", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const name of [
      "document",
      "navigator",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      "Element",
      "Node",
      "Event",
      "CustomEvent",
      "ResizeObserver",
      "MutationObserver",
      "getComputedStyle",
      "localStorage",
      "sessionStorage",
    ])
      Object.defineProperty(globalThis, name, {
        value: Reflect.get(browser, name),
        configurable: true,
        writable: true,
      });
    Object.assign(globalThis, {
      window: browser,
      IS_REACT_ACT_ENVIRONMENT: true,
      requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
      cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    });
    const { createRoot } = await import("react-dom/client");
    const { bridge } = await import("../api");
    const { store, __storeTesting } = await import("../store");
    const View = (await import("./WorldInspectorConversation")).default;
    let online = true,
      epoch = 1,
      candidate = "original",
      revision = "r1";
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
      selectedCandidateId: candidate,
      candidates: [
        {
          candidateId: candidate,
          canonicalRoot: "/project/root",
          gitCommonDir: "/project/root/.git",
          gitIdentity: candidate,
          branch: "main",
          source: "foreground_cwd",
          evidence: {
            sourceRef: "Synthetic",
            observedAt: "2026-01-01T00:00:00Z",
            basis: "reported",
          },
        },
      ],
    });
    let returning: ReturnType<
      typeof Promise.withResolvers<AgentWorktreeObservation>
    > | null = null;
    let returningList: ReturnType<
      typeof Promise.withResolvers<unknown>
    > | null = null;
    let listCalls = 0;
    const controls = new Set<(event: any) => void>();
    bridge.onControl = (listener) => {
      controls.add(listener);
      return () => controls.delete(listener);
    };
    const list = (names: string[]) => ({
      workspace_id: "workspace",
      checkout_path: "/project/root",
      root: "/project/root",
      path: "",
      entries: names.map((name) => ({
        name,
        path: name,
        type: "file",
        size: 10,
        mtime_ms: 1,
        hidden: false,
      })),
    });
    const makeClient = (): ConnectionClient => {
      const captured = epoch;
      return {
        connectionId: "alpha",
        generation: captured,
        serverRuntimeGeneration: 7,
        isCurrent: () => online && epoch === captured,
        acceptsServerGeneration: (value) => value === 7,
        async call(method, params = {}) {
          if (method === "agent_worktree.get")
            return returning ? returning.promise : observation();
          if (method === "file.list") {
            listCalls++;
            const target = params.agent_worktree as
              | { candidateId?: string }
              | undefined;
            if (target?.candidateId === "replacement") return list(["NEW.md"]);
            if (returningList) return returningList.promise;
            return list(["README.md", "guide.md", "notes.txt"]);
          }
          if (method === "git.diff_summary") {
            const target = params.agent_worktree as
              | { candidateId?: string }
              | undefined;
            return {
              workspace_id: "workspace",
              root: "/project/root",
              entries: [
                {
                  path:
                    target?.candidateId === "replacement"
                      ? "NEW-CHANGE.md"
                      : "CHANGE.md",
                  kind: "unstaged",
                  status: "M",
                  additions: 1,
                  deletions: 0,
                },
              ],
              counts: { staged: 0, unstaged: 1, untracked: 0 },
            };
          }
          if (method === "git.diff_file")
            return {
              workspace_id: "workspace",
              root: "/project/root",
              path: params.path,
              kind: "unstaged",
              diff: "diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-old\n+new\n",
              truncated: false,
            };
          return {};
        },
      };
    };
    let client = makeClient();
    bridge.connection = () => client;
    const workspace = {
      workspace_id: "workspace",
      number: 1,
      label: "Example",
      focused: true,
      pane_count: 1,
      tab_count: 1,
      agent_status: "idle",
      cwd: "/project/root",
    };
    const pane = {
      pane_id: "pane",
      terminal_id: "terminal",
      workspace_id: "workspace",
      tab_id: "tab",
      focused: true,
      agent: "codex",
      agent_status: "idle",
      revision: 1,
    };
    __storeTesting.replaceState({
      ...store.get(),
      activeConnectionId: "alpha",
      connectionGeneration: 1,
      serverRuntimeGeneration: 7,
      status: "connected",
      catalogueReady: true,
      workspaces: [workspace],
      panes: [pane],
      connections: [
        {
          id: "alpha",
          label: "Example host",
          source: "test",
          is_default: true,
          state: "ready",
          generation: 7,
        },
      ],
    });
    const host = document.createElement("div"),
      target = document.createElement("div");
    document.body.append(host, target);
    const root = createRoot(host);
    const props = {
      conversation: {
        nodeId: "node",
        resourceIdentity: "resource",
        connectionId: "alpha",
        runtimeGeneration: 7,
        workspaceId: "workspace",
        tabId: "tab",
        paneId: "pane",
        terminalId: "terminal",
        agentSessionFingerprint: subject.sessionFingerprint,
        label: "Example",
        hostLabel: "Example host",
        spaceLabel: "Example space",
        context: {
          kind: "agent" as const,
          label: "Example",
          stateLabel: "Idle",
          locationLabel: "Example",
        },
        availableViews: ["files", "changes", "terminal"] as (
          | "files"
          | "changes"
          | "terminal"
        )[],
        view: "files" as const,
        dock: "right" as const,
        size: 500,
        expanded: false,
      },
      target,
      floating: true,
      terminalActive: false,
      onChange() {},
      onClose() {},
      onResourceFocus() {},
      onTerminalPortalChange() {},
    };
    const settle = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    };
    const rows = () =>
      [...target.querySelectorAll(".file-row")].map((row) => row.textContent);
    const renderState = async () => {
      await act(async () => root.render(createElement(View, { ...props })));
      await settle();
    };
    try {
      await renderState();
      for (let turn = 0; turn < 30 && rows().length !== 3; turn++)
        await settle();
      expect(rows().length).toBe(3);
      expect(target.querySelector(".diff-tree-file")?.textContent).toContain(
        "CHANGE.md",
      );
      const diffRow = target.querySelector(".diff-tree-file");
      const explorer = target.querySelector(".file-explorer-side");
      const originalRows = rows();
      const callsBefore = listCalls;
      online = false;
      epoch++;
      client = makeClient();
      __storeTesting.replaceState({
        ...store.get(),
        status: "disconnected",
        catalogueReady: false,
        connectionGeneration: epoch,
      });
      await renderState();
      expect(rows()).toEqual(originalRows);
      expect(target.querySelector(".diff-tree-file")).toBe(diffRow);
      expect(target.querySelector(".file-explorer-side")).toBe(explorer);
      returning = Promise.withResolvers<AgentWorktreeObservation>();
      online = true;
      epoch++;
      client = makeClient();
      __storeTesting.replaceState({
        ...store.get(),
        status: "connected",
        catalogueReady: true,
        connectionGeneration: epoch,
      });
      await renderState();
      expect(rows()).toEqual(originalRows);
      expect(target.querySelector(".diff-tree-file")).toBe(diffRow);
      expect(target.querySelector(".file-explorer-side")).toBe(explorer);
      expect(
        target
          .querySelector(".workspace-inspector-body")
          ?.hasAttribute("inert"),
      ).toBe(true);
      expect(listCalls).toBe(callsBefore);
      returningList = Promise.withResolvers<unknown>();
      await act(async () => {
        returning!.resolve(observation());
        returning = null;
      });
      await settle();
      expect(rows()).toEqual(originalRows);
      expect(
        target
          .querySelector(".workspace-inspector-body")
          ?.hasAttribute("inert"),
      ).toBe(false);
      candidate = "replacement";
      revision = "r2";
      await act(async () => {
        for (const listener of controls)
          listener({
            type: "agent_conversation_changed",
            connection_id: "alpha",
            connection_generation: 7,
            pane_id: "pane",
          });
      });
      await settle();
      expect(rows().length).toBe(1);
      expect(rows()[0]).toContain("NEW.md");
      expect(target.querySelector(".diff-tree-file")?.textContent).toContain(
        "NEW-CHANGE.md",
      );
      await act(async () => returningList!.resolve(list(["LATE.md"])));
      await settle();
      expect(rows()[0]).toContain("NEW.md");
      expect(target.textContent).not.toContain("LATE.md");
    } finally {
      await act(async () => root.unmount());
      browser.happyDOM.abort();
    }
  });
}
