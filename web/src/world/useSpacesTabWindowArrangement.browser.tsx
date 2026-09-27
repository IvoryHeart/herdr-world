import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useSpacesTabWindowArrangement } from "./useSpacesTabWindowArrangement";

type TestStore = {
  snapshot(): {
    serverRuntimeGeneration: number;
    workspaces: {
      workspace_id: string;
      focused: boolean;
      active_tab_id?: string;
    }[];
    tabs: {
      tab_id: string;
      workspace_id: string;
      label: string;
      focused: boolean;
    }[];
  };
  set(patch: Record<string, unknown>): void;
  calls: { focusTab: string[]; closeTab: string[]; requestCloseTab: string[] };
};

declare global {
  interface Window {
    __SPACES_TEST_STORE__?: TestStore;
    __SPACES_TEST_LAYOUT__?: { setMobile(value: boolean): void };
    __SPACES_TEST_HOOK__?: ReturnType<typeof useSpacesTabWindowArrangement>;
  }
}

const failures: string[] = [];
window.addEventListener("error", (event) => failures.push(event.message));
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return true;
    await settle();
  }
  return false;
}

function Fixture() {
  const arrangement = useSpacesTabWindowArrangement(true);
  window.__SPACES_TEST_HOOK__ = arrangement;
  return (
    <>
      <div
        className="workspace-stage inspector-dock-right"
        style={{ position: "relative", width: 1000, height: 800 }}
      >
        <div
          id="stage"
          className="spaces-window-layer"
          ref={arrangement.onSpacesWindowLayerReady}
          style={{ position: "relative", width: 1000, height: 800 }}
        />
        <div
          id="inspector"
          className="workspace-inspector-slot is-closed"
          style={{
            position: "absolute",
            left: 340,
            top: 0,
            width: 660,
            height: 800,
            display: "none",
          }}
        />
      </div>
      {arrangement.renderWindows}
    </>
  );
}

async function run() {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Fixture />));
  const mock = window.__SPACES_TEST_STORE__!;
  const layout = window.__SPACES_TEST_LAYOUT__!;
  const hook = () => window.__SPACES_TEST_HOOK__!;
  const windows = () => [
    ...document.querySelectorAll<HTMLElement>(".spaces-tab-window"),
  ];
  window.addEventListener("herdr-world:request-close-tab", (event) => {
    const id = (event as CustomEvent<{ tabId: string }>).detail.tabId;
    mock.set({ tabs: mock.snapshot().tabs.filter((tab) => tab.tab_id !== id) });
  });

  check(
    await until(
      () => hook().arrangementControl.disabledReasons.columns === undefined,
    ),
    "two existing tabs must fit columns",
  );
  check(windows().length === 0, "Spaces must start in native Single");
  hook().arrangementControl.onSelect("columns");
  check(
    await until(
      () =>
        windows().length === 2 &&
        hook().spacesTabWindows.every(({ portal }) => !!portal),
    ),
    "Columns must portal both existing tabs",
  );
  const firstWidth = windows()[0]?.style.width;
  const openTabsBeforeCloseAll = mock.snapshot().tabs.length;
  hook().arrangementControl.onSelect("close-all");
  check(
    await until(() => hook().suspended && windows().length === 0),
    "Close all must suspend the Spaces workspace",
  );
  check(
    mock.snapshot().tabs.length === openTabsBeforeCloseAll &&
      mock.calls.closeTab.length === 0 &&
      mock.calls.requestCloseTab.length === 0,
    "Close all must preserve Herdr tabs",
  );
  const blockedStageInspector = document.getElementById("inspector")!;
  blockedStageInspector.classList.remove("is-closed");
  blockedStageInspector.style.display = "block";
  check(
    await until(() =>
      Boolean(hook().arrangementControl.disabledReasons.columns),
    ),
    "narrow stage must disable Columns",
  );
  hook().arrangementControl.onSelect("columns");
  check(
    hook().suspended && windows().length === 0,
    "unavailable placement must preserve Close all suspension",
  );
  blockedStageInspector.classList.add("is-closed");
  blockedStageInspector.style.display = "none";
  hook().resumeTab("one");
  check(
    await until(
      () =>
        !hook().suspended &&
        hook().arrangementControl.activePreset === "single",
    ),
    "explicit tab selection must reopen only Single",
  );
  hook().arrangementControl.onSelect("columns");
  check(
    await until(() => windows().length === 2),
    "an explicit arrangement must reopen eligible tabs",
  );

  const inspector = document.getElementById("inspector")!;
  inspector.classList.remove("is-closed");
  inspector.style.display = "block";
  check(
    await until(() => windows().length === 0),
    "a docked overlay with too little room must return to native Single",
  );
  inspector.classList.add("is-closed");
  inspector.style.display = "none";
  check(
    await until(() => windows().length === 2),
    "closing the Inspector must restore saved desktop windows",
  );

  const beforeAdd = mock.snapshot();
  mock.set({
    tabs: [
      ...beforeAdd.tabs,
      {
        tab_id: "three",
        workspace_id: "alpha",
        label: "Third",
        focused: false,
      },
    ],
  });
  check(
    await until(() => windows().length === 3),
    "a later tab must appear as a floating window",
  );
  check(
    windows()[0]?.style.width === firstWidth,
    "later opens must not retile earlier windows",
  );
  check(
    hook().spacesTabWindows.length === 3,
    "each visible tab must have one portal destination",
  );

  hook().arrangementControl.onSelect("rows");
  check(
    await until(
      () =>
        windows().length === 3 &&
        windows().every((window) => window.style.height !== "") &&
        windows().every(
          (window, index, all) =>
            index === 0 ||
            Number.parseFloat(window.style.top) >
              Number.parseFloat(all[index - 1]!.style.top),
        ),
    ),
    "three existing tabs must stack in rows",
  );
  for (const count of [4, 5, 6]) {
    mock.set({
      tabs: [
        ...mock.snapshot().tabs,
        {
          tab_id: `extra-${count}`,
          workspace_id: "alpha",
          label: `Extra ${count}`,
          focused: false,
        },
      ],
    });
    check(
      await until(() => windows().length === count),
      `${count} open tabs must each have a window`,
    );
    hook().arrangementControl.onSelect("grid");
    const expectedColumns = Math.ceil(Math.sqrt(count));
    const expectedRows = Math.ceil(count / expectedColumns);
    check(
      await until(() => {
        const positions = windows().map((window) => ({
          left: Number.parseFloat(window.style.left),
          top: Number.parseFloat(window.style.top),
        }));
        return (
          positions.length === count &&
          hook().arrangementControl.activePreset === "grid" &&
          new Set(positions.map(({ left }) => left)).size === expectedColumns &&
          new Set(positions.map(({ top }) => top)).size === expectedRows
        );
      }),
      `${count} tabs must accept Grid`,
    );
  }
  const gridWindows = windows();
  const gridPositions = gridWindows.map((window) => ({
    left: Number.parseFloat(window.style.left),
    top: Number.parseFloat(window.style.top),
  }));
  check(
    new Set(gridPositions.map(({ left }) => left)).size === 3 &&
      new Set(gridPositions.map(({ top }) => top)).size === 2 &&
      gridWindows.every((window) => window.style.width !== ""),
    `Grid must tile six windows in three columns and two rows: ${JSON.stringify(gridPositions)}`,
  );
  hook().arrangementControl.onSelect("single");
  check(
    await until(() => windows().length === 0),
    "Single must suspend all six extra tab windows",
  );
  hook().arrangementControl.onSelect("cascade");
  check(
    await until(() => windows().length === 6),
    "Cascade must restore all six open tab windows",
  );
  mock.set({
    tabs: mock
      .snapshot()
      .tabs.filter((tab) => !tab.tab_id.startsWith("extra-")),
  });
  hook().arrangementControl.onSelect("columns");
  check(
    await until(() => windows().length === 3),
    "removed tabs must leave only their still-open windows",
  );

  hook().onFocusSpacesTabWindow("three", "pane-three");
  await settle();
  check(
    mock.calls.focusTab.length === 0,
    "pane focus must not send a second tab-focus action",
  );
  hook().onFocusSpacesTabWindow("two", null);
  check(
    await until(() => mock.calls.focusTab.length === 1),
    "chrome focus must focus its tab once",
  );

  layout.setMobile(true);
  check(
    await until(() => windows().length === 0),
    "compact layout must use native Single",
  );
  layout.setMobile(false);
  check(
    await until(() => windows().length === 3),
    "desktop windows must return after compact mode",
  );

  const beforeSwitch = mock.snapshot();
  mock.set({
    workspaces: [
      { ...beforeSwitch.workspaces[0], focused: false },
      { workspace_id: "beta", focused: true, active_tab_id: "beta-tab" },
    ],
    tabs: [
      ...beforeSwitch.tabs,
      {
        tab_id: "beta-tab",
        workspace_id: "beta",
        label: "Beta",
        focused: true,
      },
    ],
  });
  check(
    await until(() => windows().length === 0),
    "another workspace must detach prior tab windows",
  );
  const inBeta = mock.snapshot();
  mock.set({
    workspaces: [
      { ...inBeta.workspaces[0], focused: true },
      { ...inBeta.workspaces[1], focused: false },
    ],
  });
  check(
    await until(() => windows().length === 3),
    "returning to a workspace must recover its windows",
  );
  hook().arrangementControl.onSelect("close-all");
  check(
    await until(() => hook().suspended && windows().length === 0),
    "Close all must clear a returned workspace stage",
  );
  const suspendedSnapshot = mock.snapshot();
  mock.set({
    workspaces: suspendedSnapshot.workspaces.map((workspace) => ({
      ...workspace,
      focused: workspace.workspace_id === "beta",
    })),
  });
  await settle();
  mock.set({ workspaces: suspendedSnapshot.workspaces });
  check(
    await until(() => hook().suspended && windows().length === 0),
    "navigation must retain Spaces suspension",
  );
  hook().arrangementControl.onSelect("columns");
  check(
    await until(() => windows().length === 3),
    "an arrangement must resume all eligible tabs after navigation",
  );

  document
    .querySelector<HTMLButtonElement>('button[aria-label="Close Third tab"]')
    ?.click();
  check(
    await until(
      () => windows().length === 2 && mock.calls.requestCloseTab.length === 1,
    ),
    "closing a tab must request confirmation and prune its window",
  );
  check(
    mock.calls.closeTab.length === 0,
    "window close must not bypass confirmation",
  );
  hook().arrangementControl.onSelect("restore");
  check(
    await until(() => windows().length === 0),
    "Restore must return to native Single",
  );

  hook().arrangementControl.onSelect("columns");
  check(
    await until(() => windows().length === 2),
    "Columns must remain reusable after Restore",
  );
  const many = mock.snapshot();
  mock.set({
    tabs: [
      ...many.tabs,
      ...Array.from({ length: 62 }, (_, index) => ({
        tab_id: `bulk-${index}`,
        workspace_id: "alpha",
        label: `Bulk ${index}`,
        focused: false,
      })),
    ],
  });
  check(
    await until(() => windows().length === 64),
    "new tabs must reach the Spaces window registry before Grid",
  );
  hook().arrangementControl.onSelect("grid");
  const gridLayer = document.querySelector<HTMLElement>("#stage");
  check(
    await until(
      () =>
        Boolean(gridLayer?.classList.contains("is-grid-scroll")) &&
        Boolean(gridLayer && gridLayer.scrollHeight > gridLayer.clientHeight) &&
        windows().length < 64,
    ),
    `large Grid must scroll and mount only nearby tab windows: preset=${hook().arrangementControl.activePreset}, reason=${hook().arrangementControl.disabledReasons.grid}, class=${gridLayer?.className}, size=${gridLayer?.scrollHeight}/${gridLayer?.clientHeight}, mounted=${windows().length}`,
  );
  if (gridLayer) gridLayer.scrollTop = gridLayer.scrollHeight;
  check(
    await until(() =>
      Boolean(document.querySelector('[data-tab-id="bulk-61"]')),
    ),
    "scrolling Grid must mount the last tab window",
  );
  mock.set({
    workspaces: mock
      .snapshot()
      .workspaces.map((workspace) =>
        workspace.workspace_id === "alpha"
          ? { ...workspace, active_tab_id: "bulk-0" }
          : workspace,
      ),
  });
  check(
    await until(
      () =>
        Boolean(gridLayer && gridLayer.scrollTop < 500) &&
        Boolean(document.querySelector('[data-tab-id="bulk-0"]')),
    ),
    "focusing an offscreen Grid tab must scroll it into view",
  );
  mock.set({ serverRuntimeGeneration: 8 });
  check(
    await until(() => windows().length === 0),
    "a new runtime generation must retire old windows",
  );

  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failures),
  });
}

void run().catch((error) => {
  failures.push(error instanceof Error ? error.message : String(error));
  void fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failures),
  });
});
