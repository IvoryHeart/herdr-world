import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ConnectionClient } from "./api";
import type { Pane } from "./types";
import type { TaskNotificationTarget } from "./taskNotifications";
import type { WorkspaceInspectorState } from "./workspaceResource";

// React DOM and the store have process-wide state; isolate the hook consumer.
if (process.env.NOTIFICATION_TARGET_DOM_TEST !== "1") {
  test("notification Inspector ownership across supersession and refusal", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, NOTIFICATION_TARGET_DOM_TEST: "1" },
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
  for (const successor of [
    "unavailable",
    "session",
    "focus",
    "success",
  ] as const) {
    for (const userSelected of successor === "success"
      ? [false]
      : [false, true]) {
      test(`${successor} successor ${userSelected ? "preserves user selection" : "owns original Inspector restoration"}`, async () => {
        const browser = new Window({ url: "https://world.example.test" });
        const originals = new Map<string, PropertyDescriptor | undefined>();
        for (const [key, value] of Object.entries({
          window: browser,
          document: browser.document,
          navigator: browser.navigator,
          HTMLElement: browser.HTMLElement,
          Node: browser.Node,
          localStorage: browser.localStorage,
          IS_REACT_ACT_ENVIRONMENT: true,
        })) {
          originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
          Object.defineProperty(globalThis, key, { value, configurable: true });
        }
        const { act, createElement, useState } = await import("react");
        const { createRoot } = await import("react-dom/client");
        const { store } = await import("./store");
        const { focusTaskNotification } = await import(
          "./store/notificationFocus"
        );
        const { useTaskNotificationTarget } = await import(
          "./useTaskNotificationTarget"
        );
        const baseline = store.get();
        const makeInspector = (
          connectionId: string,
        ): WorkspaceInspectorState => ({
          scope: { kind: "workspace", connectionId, workspaceId: "workspace" },
          open: true,
          view: "history",
          dock: "right",
          size: 520,
          expanded: false,
        });
        const original = makeInspector("alpha");
        const selected = { ...original, view: "files" as const };
        const inspector = {
          current: original as WorkspaceInspectorState | null,
        };
        const started = Promise.withResolvers<void>();
        const released = Promise.withResolvers<void>();
        const successorStarted = Promise.withResolvers<void>();
        const successorReleased = Promise.withResolvers<void>();
        let active = "alpha";
        let unavailable = 0;
        const activations: string[] = [];
        const presentations: string[] = [];
        const pane: Pane = {
          pane_id: "pane",
          workspace_id: "workspace",
          tab_id: "tab",
          terminal_id: "terminal",
          focused: true,
          agent: "codex",
          agent_status: "idle",
          revision: 1,
        };
        const client = (connectionId: string): ConnectionClient => ({
          connectionId,
          generation: 1,
          serverRuntimeGeneration: 7,
          isCurrent: () => true,
          acceptsServerGeneration: (value) => value === 7,
          call: async (method) =>
            method === "pane.get"
              ? { pane }
              : { session: { value: "current-session" } },
        });
        const get = spyOn(store, "get").mockImplementation(() => ({
          ...baseline,
          activeConnectionId: active,
        }));
        const connection = spyOn(store, "getConnection").mockImplementation(
          () => ({
            ...baseline,
            selectedPaneId: "pane",
            panes: [pane],
            workspaces: [
              {
                workspace_id: "workspace",
                number: 1,
                label: "Synthetic",
                focused: true,
                pane_count: 1,
                tab_count: 1,
                agent_status: "idle",
              },
            ],
          }),
        );
        const focus = spyOn(
          store,
          "focusTaskNotificationTarget",
        ).mockImplementation((target, options = {}) =>
          focusTaskNotification(target, options, {
            targetIsCurrent: () => target.connectionId !== "gone",
            captureLease: () => ({
              connectionId: target.connectionId,
              generation: 1,
              client: client(target.connectionId),
            }),
            navigationRevision: () => 1,
            isCurrent: () => true,
            focus: async (qualified) => {
              if (qualified.connectionId === "beta") {
                started.resolve();
                await released.promise;
              }
              if (qualified.connectionId === "gamma" && successor === "focus") {
                successorStarted.resolve();
                await successorReleased.promise;
              }
              return (
                qualified.isCurrent?.() !== false &&
                !(qualified.connectionId === "gamma" && successor === "focus")
              );
            },
            activate: (id) => {
              activations.push(id);
              active = id;
              return true;
            },
            unavailable: () => {
              unavailable++;
            },
          }),
        );
        let open!: ReturnType<typeof useTaskNotificationTarget>;
        let select!: (value: WorkspaceInspectorState | null) => void;
        function View() {
          const [state, setState] = useState(inspector.current);
          select = (value) => {
            inspector.current = value;
            setState(value);
          };
          open = useTaskNotificationTarget({
            client: client(active),
            inspector,
            setInspector: select,
            openChat: () => {
              presentations.push(active);
              select(makeInspector(active));
            },
            openTerminal: () => {
              presentations.push("terminal");
            },
            onOpened: () => {},
          });
          return createElement("div", {
            "data-open": state?.open,
            "data-view": state?.view,
          });
        }
        const element = document.body.appendChild(
          document.createElement("div"),
        );
        const root = createRoot(element);
        const target = (connectionId: string): TaskNotificationTarget => ({
          connectionId,
          runtimeGeneration: 7,
          workspaceId: "workspace",
          paneId: "pane",
        });
        let older: Promise<void> | undefined;
        let newer: Promise<void> | undefined;
        try {
          await act(async () => root.render(createElement(View)));
          await act(async () => {
            older = open(target("beta"));
            await started.promise;
          });
          expect(inspector.current?.open).toBe(false);
          if (userSelected) await act(async () => select(selected));
          await act(async () => {
            newer = open({
              ...target(successor === "unavailable" ? "gone" : "gamma"),
              ...(successor === "session"
                ? { agentSessionId: "stale-session" }
                : {}),
            });
            if (successor === "focus") await successorStarted.promise;
            else await newer;
          });
          if (successor === "focus") {
            await act(async () => {
              released.resolve();
              await older;
            });
            expect(inspector.current?.open).toBe(false);
            expect(active).toBe("alpha");
            await act(async () => {
              successorReleased.resolve();
              await newer;
            });
          }
          if (successor === "success") {
            expect(active).toBe("gamma");
            expect(presentations).toEqual(["gamma"]);
          } else {
            expect(unavailable).toBe(1);
            expect(inspector.current).toBe(userSelected ? selected : original);
          }
          const visible = inspector.current;
          await act(async () => {
            released.resolve();
            await older;
          });
          expect(inspector.current).toBe(visible);
          expect(active).toBe(successor === "success" ? "gamma" : "alpha");
          expect(activations).toEqual(successor === "success" ? ["gamma"] : []);
          expect(presentations).toEqual(
            successor === "success" ? ["gamma"] : [],
          );
        } finally {
          released.resolve();
          successorReleased.resolve();
          await act(async () => {
            await Promise.all([older, newer]);
            root.unmount();
          });
          focus.mockRestore();
          connection.mockRestore();
          get.mockRestore();
          element.remove();
          await browser.happyDOM.abort();
          for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
          }
        }
      });
    }
  }
}
