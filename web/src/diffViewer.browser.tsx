import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge, type ConnectionClient } from "./api";
import { roamgateLocalStorage } from "./browserStorage";
import { __storeTesting, store } from "./store";
import { detectShortcutPlatform } from "./shortcutBindings";
import type { GitDiffEntry, GitDiffFile, Workspace } from "./types";
import { DiffContentView } from "./components/DiffContentView";
import {
  DiffViewerPanel,
  type ActiveDiffSelection,
  type DiffViewerPanelHandle,
} from "./components/DiffViewerPanel";
import { writeDiffCollapseState } from "./components/diffContentState";
import {
  fileExplorerRefreshKey,
  readFileExplorerRefresh,
} from "./fileExplorerRefresh";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vendor.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
async function until(predicate: () => boolean, label: string) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`Timed out: ${label}`);
}
const workspace: Workspace = {
  workspace_id: "diff-workspace",
  number: 1,
  label: "Diff fixture",
  cwd: "/repo",
  focused: true,
  pane_count: 0,
  tab_count: 0,
  agent_status: "idle",
};
const entries: GitDiffEntry[] = [
  "src/one.ts",
  "src/two.ts",
  "src/three.ts",
].map((path) => ({
  path,
  kind: "unstaged",
  status: "M",
  generated: true,
}));
const file: GitDiffFile = {
  workspace_id: workspace.workspace_id,
  root: "/repo",
  path: entries[0].path,
  kind: "unstaged",
  diff: "",
  truncated: false,
};
let summaryCalls = 0;
let workspaceCalls = 0;
let mutationCalls = 0;
let openedFiles = 0;
const client: ConnectionClient = {
  connectionId: "diff-test",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 1,
  call: async (method, params = {}) => {
    if (method === "git.diff_summary") {
      summaryCalls += 1;
      return {
        workspace_id: workspace.workspace_id,
        root: "/repo",
        entries: mutationCalls
          ? [{ ...entries[0], kind: "staged" }, ...entries.slice(1)]
          : entries,
        counts: {},
      };
    }
    if (method === "git.diff_file")
      return { ...file, path: params.path, kind: params.kind };
    if (method === "git.file_action") {
      mutationCalls += 1;
      if (mutationCalls === 2)
        throw new Error("File changed after menu opened");
      return {};
    }
    if (method === "workspace.list") {
      workspaceCalls += 1;
      return { workspaces: [workspace] };
    }
    return {};
  },
};
const initialSelection: ActiveDiffSelection = {
  entry: entries[0],
  file,
  entries,
  files: {},
  fileErrors: {},
  loading: false,
  error: null,
  summaryLoading: false,
};
function Fixture({ mobile }: { mobile: boolean }) {
  const [selection, setSelection] = useState(initialSelection);
  const panelRef = useRef<DiffViewerPanelHandle>(null);
  return (
    <>
      <DiffViewerPanel
        ref={panelRef}
        workspaceId={workspace.workspace_id}
        resourceKey="diff-fixture"
        onSelectionChange={setSelection}
        onOpenFile={() => openedFiles++}
      />
      <DiffContentView
        {...selection}
        files={{
          ...selection.files,
          "unstaged:search.ts": { ...file, path: "search.ts", diff: "needle" },
        }}
        mobile={mobile}
        resourceKey="diff-fixture"
        connectionClient={client}
        onSelectFile={(entry) => panelRef.current?.selectEntry(entry)}
      />
    </>
  );
}
async function run() {
  const previousState = store.get();
  const originalConnection = bridge.connection;
  bridge.connection = () => client;
  __storeTesting.replaceState({
    ...previousState,
    activeConnectionId: client.connectionId,
    connectionGeneration: 1,
    status: "connected",
    connectionPaused: false,
    workspaces: [workspace],
    tabs: [],
    panes: [],
    connections: [
      {
        id: client.connectionId,
        label: "Diff test",
        source: "test",
        is_default: true,
        state: "ready",
        generation: 1,
      },
    ],
  });
  roamgateLocalStorage.setItem("diffViewMode", "unified");
  roamgateLocalStorage.setItem("desktopDiffWrap", "true");
  roamgateLocalStorage.setItem("mobileDiffWrap", "true");
  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;flex-direction:column;width:100%;height:780px";
  document.body.append(container);
  const root = createRoot(container);
  const firstSection = () =>
    container.querySelector<HTMLElement>(
      '[data-diff-entry-key="unstaged:src/one.ts"]',
    )!;
  const collapsed = () => !firstSection()?.querySelector(".diff-content-state");
  const treeFile = () =>
    container.querySelector<HTMLButtonElement>(".diff-tree-file")!;
  const folder = () =>
    container.querySelector<HTMLButtonElement>(".diff-tree-folder")!;
  const menu = () => container.querySelector<HTMLElement>('[role="menu"]');
  const closeMenu = async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await until(() => !menu(), "close menu");
  };
  const searchKey = (target: EventTarget) => {
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: detectShortcutPlatform() !== "mac",
      metaKey: detectShortcutPlatform() === "mac",
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    // Start with a cached generated file and an explicit collapsed state.
    writeDiffCollapseState(
      "initial-diff",
      new Map([["unstaged:src/one.ts", true]]),
    );
    flushSync(() =>
      root.render(
        <DiffContentView
          {...initialSelection}
          resourceKey="initial-diff"
          connectionClient={client}
        />,
      ),
    );
    await until(() => !collapsed(), "initial cached selection expands");
    root.render(<Fixture mobile={false} />);
    await until(() => !!treeFile() && !collapsed(), "tree and diff ready");
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      await settle();
      for (const mobile of [true, false]) {
        flushSync(() => root.render(<Fixture mobile={mobile} />));
        await settle();
        check(
          !!firstSection().querySelector(".diff-file-collapse") === !mobile,
          `${theme}: collapse button did not follow compact mode`,
        );
        const title = firstSection().querySelector<HTMLElement>(
          ".diff-file-section-title",
        )!;
        check(
          (title.getAttribute("role") === "button") === mobile,
          `${theme}: whole-row toggle did not follow compact mode`,
        );
        if (mobile) {
          check(!searchKey(title), "Compact section consumed browser search");
          check(
            !searchKey(window),
            "Compact window handler consumed browser search",
          );
          title.focus();
          title.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        } else {
          check(searchKey(title), "Desktop search shortcut was not handled");
          await until(
            () =>
              document.activeElement ===
              container.querySelector(".diff-search input"),
            "search focused",
          );
          firstSection()
            .querySelector<HTMLButtonElement>(".diff-file-collapse")!
            .click();
        }
        await until(collapsed, "manual collapse");
        // A non-selection render must preserve the user's manual collapse.
        flushSync(() => root.render(<Fixture mobile={mobile} />));
        check(
          collapsed(),
          "Unrelated render expanded a manually collapsed file",
        );
        treeFile().click();
        await until(
          () => !collapsed(),
          "reselecting the same tree file expands",
        );
      }
    }
    folder().focus();
    folder().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => !!menu(), "keyboard folder menu");
    await until(() => !!menu()?.contains(document.activeElement), "menu focus");
    check(
      menu()!.querySelector(".context-menu-group-title")?.textContent ===
        "Folder",
      "Populated folder labeled as file",
    );
    check(
      !menu()!.textContent?.includes("Open file"),
      "Folder offers Open file",
    );
    const bounds = menu()!.getBoundingClientRect();
    check(
      bounds.left >= 0 && bounds.right <= innerWidth + 1,
      "Folder menu overflows viewport",
    );
    await closeMenu();
    check(document.activeElement === folder(), "Folder focus was not restored");

    const originalSetTimeout = window.setTimeout;
    let triggerLongPress: (() => void) | undefined;
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 550 && typeof handler === "function") {
        triggerLongPress = () => handler();
        return -1;
      }
      return originalSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    try {
      folder().dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerType: "touch",
          clientX: 20,
          clientY: 80,
          bubbles: true,
        }),
      );
      if (!triggerLongPress) throw new Error("Long press was not armed");
      flushSync(() => triggerLongPress!());
    } finally {
      window.setTimeout = originalSetTimeout;
    }
    folder().dispatchEvent(
      new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }),
    );
    flushSync(() => folder().click());
    check(!!treeFile(), "Long press also collapsed the folder");
    await until(
      () => !!menu()?.contains(document.activeElement),
      "long press menu focus",
    );
    await closeMenu();
    flushSync(() => folder().click());
    check(!treeFile(), "Normal folder click stopped toggling after long press");
    flushSync(() => folder().click());

    treeFile().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 100,
      }),
    );
    await until(() => !!menu(), "file context menu");
    const openFile = [
      ...menu()!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Open file");
    check(!!openFile, "File menu lost Open file");
    openFile?.click();
    await until(() => !menu(), "open file closes menu");
    check(openedFiles === 1, "Open file did not target a file");

    folder().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 80,
      }),
    );
    await until(() => !!menu(), "folder action menu");
    const summariesBefore = summaryCalls;
    const refreshKey = fileExplorerRefreshKey(client, workspace.workspace_id);
    const explorerBefore = readFileExplorerRefresh(refreshKey);
    const stage = [
      ...menu()!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Stage all changes");
    if (!stage) throw new Error("Missing folder stage action");
    stage.click();
    await until(
      () => summaryCalls > summariesBefore && mutationCalls === 2,
      "partial failure refresh",
    );
    check(
      workspaceCalls > 0,
      "Partial failure did not refresh workspace status",
    );
    check(
      readFileExplorerRefresh(refreshKey) > explorerBefore,
      "Partial failure did not refresh explorer",
    );
    check(
      store.get().notice?.kind === "error" &&
        !!store.get().notice?.detail?.includes("1 of 3 files completed"),
      "Partial failure lost completed count",
    );
    await until(
      () =>
        !!container.querySelector('[data-diff-entry-key="staged:src/one.ts"]'),
      "refreshed tree",
    );
    check(mutationCalls === 2, "Batch continued after a failure");
  } finally {
    root.unmount();
    container.remove();
    bridge.connection = originalConnection;
    __storeTesting.replaceState(previousState);
  }
}
run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() => {
    void fetch("/result", { method: "POST", body: JSON.stringify(failures) });
  });
