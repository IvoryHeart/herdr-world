import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { HerdrSetupCard } from "./HerdrSetupCard";
import { TownHerdrSetupOffer } from "../world/WorldStatus";
import { buildWorldObject, type WorldObject } from "../world/worldObject";
import { worldObjectForHosts } from "../world/worldFilters";
import type { WorldRuntimeConnection } from "../world/runtimeStore";
import "../styles/tokens.css";
import "../styles/base.css";
import "../world/world-stage.css";

const params = new URLSearchParams(location.search);
const preview = params.has("preview");
const nativeFetch = window.fetch.bind(window);
let state = params.get("state") ?? "missing";
let allowed = true;
let statusFailure = false;
let posts = 0;
let statusRequests = 0;
let confirmed = false;
let completeSetup: ((response: Response) => void) | undefined;
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === "/api/herdr/status") {
    statusRequests++;
    return Promise.resolve(
      Response.json(
        { state, can_setup: allowed, verified_version: "0.9.0" },
        { status: statusFailure ? 503 : 200 },
      ),
    );
  }
  if (url === "/api/herdr/setup") {
    posts++;
    confirmed =
      init?.method === "POST" &&
      new Headers(init.headers).get("x-herdr-world-herdr-setup") === "1";
    return new Promise<Response>((resolve) => {
      completeSetup = resolve;
      if (preview && params.get("outcome") === "error") {
        setTimeout(
          () =>
            resolve(
              Response.json(
                {
                  error:
                    "Simulated download failure. No installation was attempted.",
                },
                { status: 502 },
              ),
            ),
          1500,
        );
      }
    });
  }
  return nativeFetch(input, init);
}) as typeof fetch;

const host = document.createElement("main");
host.style.cssText =
  "height:100%;overflow:auto;display:flex;align-items:safe center;justify-content:center;padding:24px";
document.body.append(host);
const root = createRoot(host);
let key = 0;
function render(
  compact = false,
  fallback = "Original connection details",
  enabled = true,
) {
  flushSync(() =>
    root.render(
      <HerdrSetupCard key={key} compact={compact} enabled={enabled}>
        <span data-fallback>{fallback}</span>
      </HerdrSetupCard>,
    ),
  );
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate() && Date.now() < deadline) await settle();
  if (!predicate()) throw new Error(`Timed out waiting for ${message}`);
}
const primary = () =>
  document.querySelector<HTMLButtonElement>(".herdr-setup-primary")!;
function click(button: HTMLButtonElement) {
  flushSync(() => button.click());
}
const failures: string[] = [];
function check(value: unknown, message: string) {
  if (!value) failures.push(message);
}

async function run() {
  render();
  await waitFor(
    () =>
      document.querySelector("h2")?.textContent ===
        "Your workspace starts here" &&
      document.body.textContent?.includes("Verified 0.9.0") === true &&
      document.querySelector(".herdr-setup-primary") !== null,
    "the initial Herdr status fetch and setup card render",
  );
  check(
    document.querySelector("h2")?.textContent === "Your workspace starts here",
    "missing: onboarding title",
  );
  check(
    document.body.textContent?.includes("Verified 0.9.0"),
    "missing: verified version",
  );
  check(
    !document.querySelector("[data-fallback]"),
    "raw connection error must not compete with setup",
  );
  check(posts === 0, "mount must not install");
  click(primary());
  check(
    document.querySelector("h2")?.textContent === "Install Herdr 0.9.0?",
    "explicit confirmation title",
  );
  check(
    primary().textContent?.includes("Install & start"),
    "explicit confirmation action",
  );
  check(posts === 0, "review must not send POST");
  render(false, "A different connection error");
  check(
    primary().textContent?.includes("Install & start"),
    "fallback changes must not reset confirmation",
  );
  click(document.querySelector<HTMLButtonElement>(".herdr-setup-cancel")!);
  await settle();
  check(
    document.activeElement === primary(),
    "cancel restores review button focus",
  );
  click(primary());
  primary().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  check(
    primary().textContent?.includes("Set up Herdr"),
    "Escape cancels confirmation",
  );
  click(primary());
  click(primary());
  click(primary());
  await settle();
  check(posts === 1 && confirmed, "single confirmed POST with required header");
  check(primary().disabled, "busy action disabled");
  check(
    document.querySelector(".herdr-setup-progress[role=status]"),
    "busy state announced",
  );
  completeSetup?.(
    Response.json(
      { error: "Download unavailable. Please try again." },
      { status: 502 },
    ),
  );
  await settle();
  check(
    document
      .querySelector("[role=alert]")
      ?.textContent?.includes("Download unavailable"),
    "failure visible",
  );
  check(
    !primary().disabled && primary().textContent?.includes("Try again"),
    "failure can retry",
  );
  click(primary());
  await settle();
  check(posts === 2, "retry sends one request");
  completeSetup?.(Response.json({ ok: false }, { status: 200 }));
  await settle();
  check(
    document.querySelector("[role=alert]"),
    "malformed success is not accepted",
  );

  for (const width of [342, 296]) {
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      key++;
      render(width === 296);
      host.style.width = `${width}px`;
      host.style.padding = "0";
      await settle();
      click(primary());
      const card = document.querySelector<HTMLElement>(".herdr-setup-card")!;
      check(
        card.scrollWidth <= card.clientWidth,
        `${width}/${theme}: card overflow`,
      );
      check(
        card.getBoundingClientRect().width <= width,
        `${width}/${theme}: width overflow`,
      );
      check(
        primary().getBoundingClientRect().height >= 42,
        `${width}/${theme}: touch target`,
      );
    }
  }
  host.style.width = "";
  state = "installed";
  key++;
  render();
  await settle();
  check(
    primary().textContent?.includes("Start Herdr"),
    "installed: start action",
  );
  check(
    !document.body.textContent?.includes("Verified 0.9.0"),
    "installed: don't mislabel existing binary version",
  );
  click(primary());
  check(
    primary().textContent?.includes("Start service"),
    "installed: explicit service confirmation",
  );

  for (const scenario of [
    "running",
    "blocked",
    "failed-status",
    "other-connection",
  ]) {
    state = scenario === "running" ? "running" : "missing";
    allowed = scenario !== "blocked";
    statusFailure = scenario === "failed-status";
    key++;
    render(
      false,
      "Original connection details",
      scenario !== "other-connection",
    );
    await settle();
    check(
      !document.querySelector(".herdr-setup-card"),
      `${scenario}: no setup action`,
    );
    check(
      document.querySelector("[data-fallback]"),
      `${scenario}: preserve fallback`,
    );
  }
}

/** Town placement: the offer inside a synthetic stage, gated by the world. */
async function townPlacement() {
  const townWorld = (
    local: Partial<WorldRuntimeConnection>,
    remoteReady = false,
  ) => {
    const connection = (id: string): WorldRuntimeConnection => ({
      connectionId: id,
      label: id,
      source: "test",
      isDefault: id === "local",
      state: "error",
      generation: 1,
      snapshotGeneration: null,
      stale: false,
      actionable: false,
      snapshot: null,
    });
    return buildWorldObject([
      { ...connection("local"), ...local },
      { ...connection("remote"), state: remoteReady ? "ready" : "error" },
    ]);
  };
  const failing = {
    state: "error",
    error: "Synthetic socket refused",
  } as const;
  const aggregateReady = townWorld(failing, true);
  const stage = document.createElement("div");
  stage.className = "town-stage";
  // town.css's stage box, without the canvas it frames.
  stage.style.cssText =
    "position:relative;overflow:hidden;width:1280px;height:800px;background:#2f4a2b";
  document.body.replaceChildren(stage);
  document.body.style.margin = "0";
  const town = createRoot(stage);
  const show = (world: WorldObject, aggregate = world) =>
    flushSync(() =>
      town.render(
        <TownHerdrSetupOffer key={key} world={world} aggregate={aggregate} />,
      ),
    );
  const card = () =>
    document.querySelector<HTMLElement>(
      ".town-stage > .town-herdr-setup > .herdr-setup-card",
    );

  allowed = true;
  statusFailure = false;
  for (const [name, world, aggregate] of [
    ["connecting", townWorld({ state: "connecting" })],
    ["disconnected", townWorld({ state: "disconnected" })],
    ["another host ready", aggregateReady],
    [
      "ready host hidden by Hosts",
      worldObjectForHosts(aggregateReady, ["local"]),
      aggregateReady,
    ],
  ] as const) {
    const before = statusRequests;
    key++;
    show(world, aggregate);
    await settle();
    check(
      !document.querySelector(".town-herdr-setup"),
      `town ${name}: no card`,
    );
    check(statusRequests === before, `town ${name}: no status request`);
  }

  state = "running";
  key++;
  show(townWorld(failing));
  await settle();
  check(!card(), "town running: no card");

  state = "missing";
  const postsBefore = posts;
  key++;
  show(townWorld({ ...failing, state: "reconnecting" }));
  await waitFor(() => card() !== null, "the Town setup card");
  click(primary());
  check(
    document.querySelector("h2")?.textContent === "Install Herdr 0.9.0?",
    "town missing: install confirmation",
  );
  check(posts === postsBefore, "town review must not send POST");

  for (const [width, height] of [
    [390, 844],
    [1280, 800],
    [390, 320],
  ]) {
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    await settle();
    const panel = document.querySelector<HTMLElement>(".town-herdr-setup")!;
    const outer = stage.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const size = `town ${width}x${height}`;
    check(box.left - outer.left >= 16, `${size}: left gutter`);
    check(outer.right - box.right >= 16, `${size}: right gutter`);
    check(box.bottom <= outer.bottom, `${size}: inside the stage`);
    check(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      `${size}: no horizontal page scroll`,
    );
    check(card()!.scrollWidth <= card()!.clientWidth, `${size}: card overflow`);
    if (height < 400)
      check(
        panel.scrollHeight > panel.clientHeight,
        `${size}: scrolls inside itself`,
      );
  }
  town.unmount();
}

if (preview) {
  document.documentElement.dataset.theme = params.get("theme") ?? "dark";
  render(params.has("compact"));
  await settle();
  if (params.has("confirm")) click(primary());
  if (params.has("busy")) {
    click(primary());
    click(primary());
  }
} else {
  try {
    await run();
    await townPlacement();
  } catch (error) {
    failures.push(String(error));
  }
  await nativeFetch("/result", {
    method: "POST",
    body: JSON.stringify(failures),
  });
}
