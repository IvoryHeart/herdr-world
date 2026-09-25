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
    check(
      await until(
        () =>
          windows().length === count &&
          hook().arrangementControl.activePreset === "grid",
      ),
      `${count} tabs must accept Grid`,
    );
  }
  const gridWindows = windows();
  const [topLeft, topRight, bottomLeft, bottomRight] = gridWindows.map(
    (window) => ({
      left: Number.parseFloat(window.style.left),
      top: Number.parseFloat(window.style.top),
    }),
  );
  check(
    topLeft?.left === bottomLeft?.left &&
      topRight?.left === bottomRight?.left &&
      topLeft?.top === topRight?.top &&
      bottomLeft?.top === bottomRight?.top &&
      topRight.left > topLeft.left &&
      bottomLeft.top > topLeft.top &&
      gridWindows.slice(4).every((window) => window.style.width !== ""),
    "Grid must tile four corners and keep fifth and sixth windows floating",
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
