import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ConnectionClient } from "../api";
import type { AgentChatStartupIntent } from "./useAgentChatStartup";
import type { Pane } from "../types";

const mode = process.env.AGENT_STARTUP_DOM_MODE;
if (!mode) {
  for (const consumer of ["hook", "inspector"])
    test(`${consumer} preserves the captured startup intent across focused replacements`, async () => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, AGENT_STARTUP_DOM_MODE: consumer },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code) throw Error(out + "\n" + err);
      expect(code).toBe(0);
    }, 15000);
} else {
  const browser = new Window({ url: "https://world.example.test" });
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const listeners = new Set<() => void>();
  mock.module("../conversationWatch", () => ({
    watchConversation: (_c: unknown, _p: unknown, f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  }));
  const original = {
    pane_id: "pane",
    terminal_id: "original-terminal",
    workspace_id: "room",
    tab_id: "tab",
    agent: "claude",
    focused: true,
    revision: 1,
  } as Pane;
  let observed = original;
  let replaceFocusedPane = () => {};
  let chooseView: ((view: "terminal" | "history") => void) | undefined;
  let current = true;
  let calls = 0;
  let replies: Array<ReturnType<typeof Promise.withResolvers<unknown>>> = [];
  const client = {
    connectionId: "synthetic",
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => current,
    acceptsServerGeneration: (v: unknown) => v === 7,
    call: async (method: string) => {
      if (method === "agent_conversation.latest") {
        calls++;
        const reply = Promise.withResolvers<unknown>();
        replies.push(reply);
        return reply.promise;
      }
      return {};
    },
  } as ConnectionClient;
  let Inspector:
    | typeof import("./WorldInspectorConversation").default
    | undefined;
  if (mode === "inspector") {
    const realStore = await import("../store");
    const realClient = await import("../useConnectionClient");
    const snapshot = {
      ...realStore.store.get(),
      workspaces: [
        {
          workspace_id: "room",
          number: 1,
          label: "Demo",
          cwd: "/work/example",
          focused: true,
          pane_count: 1,
          tab_count: 1,
        },
      ],
      tabs: [],
      panes: [original],
      status: "connected",
      catalogueReady: true,
    };
    replaceFocusedPane = () => {
      snapshot.panes = [observed];
    };
    mock.module("../store", () => ({
      ...realStore,
      useStoreSelector: (select: (s: typeof snapshot) => unknown) =>
        select(snapshot),
    }));
    mock.module("../useConnectionClient", () => ({
      ...realClient,
      useConnectionClient: () => client,
    }));
    mock.module("../useAgentWorktree", () => ({
      useAgentWorktree: () => ({ client, view: null }),
    }));
    mock.module("../components/WorkspaceInspectorHost", () => ({
      WorkspaceInspectorHost: (props: {
        onViewChange: (view: "terminal" | "history") => void;
      }) => {
        chooseView = props.onViewChange;
        return h("div");
      },
    }));
    Inspector = (await import("./WorldInspectorConversation")).default;
  }
  const { useAgentChatStartup } = await import("./useAgentChatStartup");
  for (const scenario of [
    "arrival",
    "manual",
    "unmount",
    "runtime",
    "terminal",
    "harness",
    "terminal-restore",
    "harness-restore",
    "explicit",
  ]) {
    test(`${mode}: ${scenario}`, async () => {
      observed = original;
      replaceFocusedPane();
      current = true;
      calls = 0;
      replies = [];
      chooseView = undefined;
      let ready = 0;
      let cancel = () => {};
      let captured: AgentChatStartupIntent | undefined;
      const host = document.body.appendChild(document.createElement("div"));
      const target = document.body.appendChild(document.createElement("div"));
      const root = createRoot(host);
      let mounted = true;
      const conversation = {
        nodeId: "node",
        resourceIdentity: "original-resource",
        hostLabel: "Demo",
        spaceLabel: "Room",
        connectionId: "synthetic",
        runtimeGeneration: 7,
        workspaceId: "room",
        tabId: "tab",
        paneId: "pane",
        terminalId: "original-terminal",
        context: {
          kind: "agent" as const,
          label: "Claude",
          agent: "claude",
          stateLabel: "Starting",
          locationLabel: "Room",
        },
        label: "Claude",
        view: "terminal" as const,
        availableViews: ["terminal", "history"] as Array<
          "terminal" | "history"
        >,
        awaitChatSession: true,
        dock: "right" as const,
        size: 400,
        expanded: false,
      };
      function Harness() {
        if (Inspector)
          return h(Inspector, {
            conversation,
            target,
            floating: true,
            terminalActive: false,
            onChange: (change) => {
              if (change.view === "history") ready++;
            },
            onClose() {},
            onResourceFocus() {},
            onTerminalPortalChange() {},
          });
        return h(HookHarness);
      }
      function HookHarness() {
        cancel = useAgentChatStartup(
          client,
          observed,
          true,
          () => ready++,
          captured,
        );
        return h("div");
      }
      try {
        await act(async () => root.render(h(Harness)));
        expect(calls).toBe(1);
        if (scenario === "manual")
          await act(async () => {
            if (Inspector) {
              expect(chooseView).toBeDefined();
              chooseView!("terminal");
            } else cancel();
          });
        if (scenario === "runtime") current = false;
        if (scenario === "unmount") {
          await act(async () => root.unmount());
          mounted = false;
        }
        const replacement =
          scenario.startsWith("terminal") ||
          scenario.startsWith("harness") ||
          scenario === "explicit";
        if (replacement) {
          observed =
            scenario.startsWith("terminal") || scenario === "explicit"
              ? { ...original, terminal_id: "replacement-terminal" }
              : { ...original, agent: "codex" };
          replaceFocusedPane();
          await act(async () => root.render(h(Harness)));
        }
        if (scenario.endsWith("-restore")) {
          observed = original;
          replaceFocusedPane();
          await act(async () => root.render(h(Harness)));
        }
        if (scenario === "explicit") {
          captured = {
            connectionId: "synthetic",
            runtimeGeneration: 7,
            paneId: observed.pane_id,
            terminalId: observed.terminal_id,
            agent: observed.agent,
          };
          Object.assign(conversation, {
            terminalId: observed.terminal_id,
            startupIntent: captured,
          });
          await act(async () => root.render(h(Harness)));
        }
        await act(async () => {
          for (const reply of replies)
            reply.resolve({
              status: "ok",
              pane_id: "pane",
              session_fingerprint: "a".repeat(64),
            });
        });
        expect(ready).toBe(
          scenario === "arrival" || scenario === "explicit" ? 1 : 0,
        );
        if (replacement) expect(calls).toBe(scenario === "explicit" ? 2 : 1);
      } finally {
        if (mounted) await act(async () => root.unmount());
        host.remove();
        target.remove();
      }
    });
  }
}
