import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";
import type { ConnectionClient } from "../api";

if (process.env.HERDR_WORLD_DIALOG_EFFECT_DOM_TEST !== "1") {
  test("dialog effect regressions in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_DIALOG_EFFECT_DOM_TEST: "1" },
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
  }, 15_000);
} else {
  await registerDomTests();
}

async function registerDomTests() {
  const browser = new Window({ url: "http://localhost" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "localStorage",
    "sessionStorage",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? browser : browser[key],
      writable: true,
      configurable: true,
    });
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const {
    act,
    createElement: h,
    Fragment,
    startTransition,
    Suspense,
  } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ConfirmDialog, MessageDialog, TextInputDialog } = await import(
    "./ModalDialogs"
  );
  const { CreateWorkspaceDialog } = await import("./CreateWorkspaceDialog");
  const { WorktreeOpenDialog } = await import("./WorktreeOpenDialog");
  const { bridge } = await import("../api");
  let listCalls = 0;
  const client: ConnectionClient = {
    connectionId: "dialog-test",
    generation: 1,
    serverRuntimeGeneration: 1,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method) => {
      expect(method).toBe("worktree.list");
      listCalls += 1;
      return {
        type: "worktree_list",
        source: {
          repo_key: "repo",
          repo_name: "Repo",
          repo_root: "/repo",
          source_checkout_path: "/repo",
        },
        worktrees: [],
      };
    },
  };
  const connection = spyOn(bridge, "connection").mockReturnValue(client);
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    await browser.happyDOM.whenAsyncComplete();
  });
  afterAll(async () => {
    connection.mockRestore();
    await browser.happyDOM.close();
  });

  type Callbacks = {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
  };
  const dialogs: Array<{
    name: string;
    render: (props: Callbacks) => ReactElement;
    focus: string;
    enter?: "confirm" | "close";
  }> = [
    {
      name: "text input",
      render: ({ open, onClose }) =>
        h(TextInputDialog, {
          open,
          onClose,
          title: "Rename",
          label: "Name",
          initialValue: "original",
          onSubmit: () => {},
        }),
      focus: "input",
    },
    {
      name: "confirm",
      render: (props) =>
        h(ConfirmDialog, { ...props, title: "Confirm", message: "Continue?" }),
      focus: '[role="dialog"]',
      enter: "confirm",
    },
    {
      name: "message",
      render: ({ open, onClose }) =>
        h(MessageDialog, { open, onClose, title: "Message", message: "Ready" }),
      focus: '[role="alertdialog"]',
      enter: "close",
    },
    {
      name: "create workspace",
      render: ({ open, onClose }) =>
        h(CreateWorkspaceDialog, { open, onClose, initialName: "Workspace" }),
      focus: "input",
    },
    {
      name: "open worktree",
      render: ({ open, onClose }) =>
        h(WorktreeOpenDialog, { open, onClose, workspaceId: "workspace" }),
      focus: "input",
    },
  ];

  for (const dialog of dialogs) {
    test(`${dialog.name} keeps committed keyboard callbacks and cleans up focus/listeners`, async () => {
      const container = document.createElement("div");
      const outside = document.createElement("button");
      document.body.append(container, outside);
      root = createRoot(container);
      const calls: string[] = [];
      const callbacks = (version: string): Callbacks => ({
        open: true,
        onClose: () => calls.push(`${version}:close`),
        onConfirm: () => calls.push(`${version}:confirm`),
      });
      const never = new Promise<never>(() => {});
      function Suspend({ blocked }: { blocked: boolean }) {
        if (blocked) throw never;
        return null;
      }
      const render = (props: Callbacks, blocked = false) =>
        root!.render(
          h(
            Suspense,
            { fallback: h("p", null, "Pending") },
            h(Fragment, null, dialog.render(props), h(Suspend, { blocked })),
          ),
        );
      const key = (target: Element, value: string) =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: value,
            bubbles: true,
            cancelable: true,
          }),
        );
      const initialCalls = listCalls;
      await act(async () => render(callbacks("old")));
      await browser.happyDOM.whenAsyncComplete();
      const focused = container.querySelector<HTMLElement>(dialog.focus)!;
      expect(document.activeElement === focused).toBe(true);
      outside.focus();
      await act(async () => render(callbacks("current")));
      expect(document.activeElement === outside).toBe(true);

      // A transition renders new callbacks but does not commit its suspended
      // tree. The original DOM and native listener must keep committed props.
      await act(async () => {
        startTransition(() => render(callbacks("uncommitted"), true));
      });
      expect(container.textContent).not.toContain("Pending");
      await act(async () => key(outside, "Escape"));
      expect(calls).toEqual(["current:close"]);
      focused.focus();
      if (dialog.enter) {
        await act(async () => key(focused, "Enter"));
        expect(calls).toEqual(
          dialog.enter === "confirm"
            ? ["current:close", "current:confirm", "current:close"]
            : ["current:close", "current:close"],
        );
        const button = container.querySelector<HTMLButtonElement>(
          ".modal-actions button",
        )!;
        const beforeNativeEnter = calls.length;
        button.focus();
        await act(async () => key(button, "Enter"));
        expect(calls).toHaveLength(beforeNativeEnter);
      }
      const buttons = container.querySelectorAll<HTMLButtonElement>(
        ".modal-actions button",
      );
      await act(async () => buttons[0].click());
      expect(calls[calls.length - 1]).toBe("current:close");
      if (dialog.enter === "confirm") {
        await act(async () => buttons[1].click());
        expect(calls.slice(-2)).toEqual(["current:confirm", "current:close"]);
      }
      if (dialog.name === "open worktree") {
        expect(listCalls - initialCalls).toBe(1);
      }

      await act(async () => render({ ...callbacks("closed"), open: false }));
      expect(container.childElementCount).toBe(0);
      const beforeClose = calls.length;
      await act(async () => key(outside, "Escape"));
      expect(calls).toHaveLength(beforeClose);
      await act(async () => render(callbacks("reopened")));
      await act(async () => root!.unmount());
      root = null;
      outside.focus();
      await browser.happyDOM.whenAsyncComplete();
      expect(document.activeElement === outside).toBe(true);
      await act(async () => key(outside, "Escape"));
      expect(calls).toHaveLength(beforeClose);
    });
  }
}
