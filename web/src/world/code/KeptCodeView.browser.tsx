import { clock as fixtureTime } from "../testing/installTestClock";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { worldSessionStorage } from "../../browserStorage";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../world.css";
import type { WorldObject, WorldSpaceObject } from "../worldObject";
import type { IdeClient, IdeInstance, IdeStatus } from "./ideClient";
import { KeptCodeView } from "./KeptCodeView";

// The Code view keeps VS Code's state (#1262): a workbench with an unsaved
// edit and an open webview stays loaded, unchanged, while Town or Spaces is
// in front and when Code comes back; it never loads again. The fake
// workbench (KeptCodeView.browser.test.ts) counts its loads on the server,
// and its webview comes from another origin, as VS Code's do.

const failures: string[] = [];
window.addEventListener("error", (event) =>
  failures.push(`Uncaught: ${event.error?.stack ?? event.message}`),
);
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  failures.push(
    args
      .map((arg) =>
        arg instanceof Error ? (arg.stack ?? arg.message) : String(arg),
      )
      .join(" ")
      .slice(0, 600),
  );
  consoleError(...args);
};
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const advance = (ms = 80) => fixtureTime.advance(ms);
async function until(condition: () => boolean, message: string, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await advance(30);
  }
  failures.push(message);
  return false;
}
const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

const INSTANCE_ID = "keptWorkbench0001";
const world = {
  spaces: [
    {
      id: "s-api",
      kind: "space",
      connectionId: "local",
      generation: 7,
      hostLabel: "This computer",
      label: "api",
      stale: false,
      children: [],
      workspace: { cwd: "/srv/example/api" },
    } as unknown as WorldSpaceObject,
  ],
  leaves: [],
} as unknown as WorldObject;

const instance: IdeInstance = {
  id: INSTANCE_ID,
  provider: "code-server",
  connectionId: "local",
  folder: "/srv/example/api",
  state: "ready",
  url: `/ide/${INSTANCE_ID}/`,
  startedAt: new Date().toISOString(),
};
const ideStatus: IdeStatus = {
  providers: [
    {
      id: "code-server",
      label: "code-server",
      marketplace: "Open VSX",
      terms: [],
      setupUrl: "https://example.com/download",
      detection: {
        state: "detected",
        path: "/opt/example/bin/code-server",
        version: "4.99.0",
        configured: false,
      },
      needsSecurePage: false,
      enabled: true,
      trustedAt: null,
      termsAcceptedAt: null,
      binary: null,
    },
  ],
  instances: [instance],
  localConnections: ["local"],
};
const client: IdeClient = {
  status: async () => ideStatus,
  enable: async () => ideStatus,
  disable: async () => ideStatus,
  configure: async () => ideStatus,
  open: async () => ({ ok: true, instance }),
  stop: async () => ideStatus,
  forget: async () => ideStatus,
  subscribe: () => () => {},
};

/** What the fake workbench page records about itself. */
type Workbench = Window & {
  loadToken?: string;
  sizes?: Array<[number, number]>;
  webviews?: string[];
};

async function loads(): Promise<{ ide: number; webview: number }> {
  return (await fetch("/loads")).json();
}

async function run() {
  // This tab had loaded the workbench before: as after a page reload, the
  // view says why it loads again.
  worldSessionStorage.setItem("code.loaded", JSON.stringify([INSTANCE_ID]));
  const host = document.getElementById("root")!;
  host.style.cssText = "height: 640px; width: 960px; display: flex;";
  const root = createRoot(host);
  const render = (view: "code" | "town", active = true) =>
    flushSync(() =>
      root.render(
        <main
          className="world-control-plane"
          data-active={active ? "true" : "false"}
        >
          <div className="world-view-layout">
            <section className="world-view-stage" aria-label={`${view} view`}>
              {active && view === "town" ? (
                <div className="town-stub" style={{ height: "100%" }}>
                  Town
                </div>
              ) : null}
              <KeptCodeView
                shown={active && view === "code"}
                world={world}
                client={client}
                secure
                onOpenAgent={() => {}}
                onOpenTerminal={() => {}}
              />
            </section>
          </div>
        </main>,
      ),
    );

  render("code");
  const ready = await until(
    () =>
      Boolean(
        $<HTMLIFrameElement>(
          '.code-view-frame[data-front="true"]',
        )?.contentDocument?.getElementById("editor"),
      ) &&
      (($<HTMLIFrameElement>(".code-view-frame")?.contentWindow as Workbench)
        ?.webviews?.length ?? 0) > 0,
    "the workbench and its webview load",
  );
  if (!ready) {
    const frames =
      document.querySelectorAll<HTMLIFrameElement>(".code-view-frame");
    failures.push(
      `state ${$(".code-view")?.getAttribute("data-state")}; ${frames.length} frames; front ${frames[0]?.getAttribute("data-front")}; editor ${Boolean(frames[0]?.contentDocument?.getElementById("editor"))}; webviews ${JSON.stringify((frames[0]?.contentWindow as Workbench | null)?.webviews)}; html ${document.body.innerHTML.slice(0, 600)}`,
    );
    return;
  }
  const frame = $<HTMLIFrameElement>(".code-view-frame")!;
  const bench = frame.contentWindow as Workbench;
  const token = bench.loadToken;
  const webview = bench.webviews?.[0];
  check(
    $(".code-view-reloaded")?.textContent?.includes(
      "This page reloaded, so code-server loaded again",
    ) === true,
    "after a page reload the view says the workbench loaded again",
  );
  $<HTMLButtonElement>(".code-view-reloaded button")?.click();
  await until(() => !$(".code-view-reloaded"), "the reload note closes");

  // An unsaved edit, as typing in an editor without saving.
  const editor = frame.contentDocument!.getElementById(
    "editor",
  ) as HTMLTextAreaElement;
  editor.value = "unsaved edit";
  editor.scrollTop = 0;
  const width = bench.innerWidth;
  const height = bench.innerHeight;
  check(width > 0 && height > 0, "the workbench has a size");
  bench.sizes = [];

  const unchanged = async (where: string) => {
    const now = $<HTMLIFrameElement>(".code-view-frame");
    const nowBench = now?.contentWindow as Workbench | undefined;
    check(now === frame, `${where}: the same workbench frame is mounted`);
    check(
      nowBench?.loadToken === token,
      `${where}: the workbench page did not load again`,
    );
    const field = now?.contentDocument?.getElementById("editor") as
      | HTMLTextAreaElement
      | undefined;
    check(
      field?.value === "unsaved edit",
      `${where}: the unsaved edit is still there`,
    );
    check(
      nowBench?.webviews?.length === 1 && nowBench.webviews[0] === webview,
      `${where}: the webview kept its page (${nowBench?.webviews?.join()})`,
    );
    const counted = await loads();
    check(
      counted.ide === 1 && counted.webview === 1,
      `${where}: one workbench and one webview load in all (${JSON.stringify(counted)})`,
    );
  };

  // Town in front: Code stays loaded, unseen, at its size.
  render("town");
  await advance(300);
  const keeper = $(".world-code-keeper");
  check(
    keeper?.getAttribute("data-shown") === "false" &&
      getComputedStyle(keeper).visibility === "hidden",
    "behind Town the Code view is hidden",
  );
  const town = $(".town-stub")!.getBoundingClientRect();
  check(
    document.elementFromPoint(
      town.left + town.width / 2,
      town.top + town.height / 2,
    )?.className === "town-stub",
    "Town gets the clicks, not the hidden workbench",
  );
  check(
    bench.innerWidth === width && bench.innerHeight === height,
    `behind Town the workbench keeps its size (${bench.innerWidth}×${bench.innerHeight}, was ${width}×${height})`,
  );
  await unchanged("behind Town");

  render("code");
  await advance(300);
  check(
    $<HTMLIFrameElement>('.code-view-frame[data-front="true"]') === frame,
    "back in Code the same workbench is in front",
  );
  check(
    (bench.sizes ?? []).length === 0,
    `Town and back caused no workbench resize (${JSON.stringify(bench.sizes)})`,
  );
  check(!$(".code-view-reloaded"), "nothing says it loaded again");
  await unchanged("back from Town");

  // Spaces in front: World's views are not shown at all.
  render("town", false);
  await advance(300);
  render("code");
  await advance(300);
  await unchanged("back from Spaces");

  // A window resize or phone rotation only resizes it.
  host.style.width = "700px";
  await advance(300);
  await unchanged("after a resize");
  flushSync(() => root.unmount());
}

run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    }),
  );
