import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { HerdrSetupCard } from "./HerdrSetupCard";
import { CoreConnectionCards } from "./CoreConnections";
import { parseCoreConnections } from "../coreConnections";
import { TownHerdrSetupOffer } from "../world/WorldStatus";
import { TownMasterFigure } from "../world/TownMasterCard";
import { TownMasterGreetingHost } from "../world/TownMasterGreetingHost";
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

// The herdr-core install RPC, faked: nothing is probed or installed.
const coreCalls: Array<Record<string, unknown>> = [];
let coreOutcome: "done" | "failed" = "done";
let coreStatusReads = 0;
bridge.call = (async (method: string, params: Record<string, unknown> = {}) => {
  if (method !== "connections.core_install")
    throw new Error(`unexpected RPC ${method}`);
  coreCalls.push(params);
  const installing = coreCalls.some((call) => call.action === "install");
  if (params.action === "probe")
    return {
      probe: {
        target: "linux-x86_64",
        core: null,
        // An SSH host with only the Herdr TUI keeps it as it is.
        herdr:
          (params.host as { type: string }).type === "ssh"
            ? "/home/user/.local/bin/herdr"
            : null,
        dir: "/home/user/.local/bin",
        login: "systemd",
      },
      version: "0.1.22",
    };
  if (params.action === "install")
    return { phase: "installing", version: "0.1.22", lines: [] };
  if (!installing) return { phase: "idle", version: null, lines: [] };
  coreStatusReads++;
  const lines = ["Reading the herdr-core release list..."];
  if (coreStatusReads < 2)
    return { phase: "installing", version: "0.1.22", lines };
  // Enough steps for two-digit line numbers.
  const steps = Array.from({ length: 9 }, (_, n) => `Synthetic step ${n + 2}`);
  return coreOutcome === "done"
    ? {
        phase: "done",
        version: "0.1.22",
        lines: [...lines, ...steps, "herdr-core is running."],
        connection_id: "core-local",
      }
    : {
        phase: "failed",
        version: "0.1.22",
        lines,
        error: "the download is damaged (checksum mismatch); try again",
      };
}) as typeof bridge.call;

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
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  )!;
const chooseTui = () => click(button("Use the Herdr TUI instead"));
function click(button: HTMLButtonElement) {
  flushSync(() => button.click());
}
const failures: string[] = [];
function check(value: unknown, message: string) {
  if (!value) failures.push(message);
}

/**
 * Every install log number is whole (#935): the log scrolls, so it clips
 * its outside markers at its padding edge. Checked on desktop and phones.
 */
async function checkLogNumbers(where: string) {
  for (const width of ["", "390px", "296px"]) {
    host.style.width = width;
    await settle();
    const log = document.querySelector<HTMLElement>("ol.core-install-lines");
    if (!log) {
      failures.push(`${where}: no install log`);
      continue;
    }
    const inner = log.getBoundingClientRect().left + log.clientLeft;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;white-space:pre;visibility:hidden";
    document.body.append(probe);
    [...log.children].forEach((item, index) => {
      // The marker reads "N. " in the item's own font, ending at its edge.
      probe.style.font = getComputedStyle(item).font;
      probe.textContent = `${index + 1}. `;
      const marker = probe.getBoundingClientRect().width;
      check(
        item.getBoundingClientRect().left - marker >= inner - 0.5,
        `${where} ${width || "desktop"}: log number ${index + 1} is clipped`,
      );
    });
    probe.remove();
    check(log.children.length >= 10, `${where}: two-digit numbers checked`);
  }
  host.style.width = "";
}

async function run() {
  render();
  await waitFor(
    () =>
      document.querySelector("h2")?.textContent ===
        "Your workspace starts here" &&
      document.body.textContent?.includes("herdr-core, the newest release") ===
        true &&
      document.querySelector(".herdr-setup-primary") !== null,
    "the initial Herdr status fetch and setup card render",
  );
  check(
    document.querySelector("h2")?.textContent === "Your workspace starts here",
    "missing: onboarding title",
  );
  check(
    primary().textContent?.includes("Set up herdr-core"),
    "missing: herdr-core comes first",
  );
  check(
    button("Use the Herdr TUI instead"),
    "missing: the Herdr TUI is second",
  );
  check(
    !document.querySelector("[data-fallback]"),
    "raw connection error must not compete with setup",
  );
  check(posts === 0, "mount must not install");
  chooseTui();
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
  chooseTui();
  primary().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  check(
    primary().textContent?.includes("Set up herdr-core"),
    "Escape cancels confirmation",
  );
  chooseTui();
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
      chooseTui();
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
  chooseTui();
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

  // The Town Master's greeting and either setup card never cover each other
  // (#935): the greeting waits while a card is up and opens once it is gone.
  stage.style.width = "1280px";
  stage.style.height = "800px";
  const figure = document.createElement("div");
  stage.append(figure);
  const figureRoot = createRoot(figure);
  flushSync(() => figureRoot.render(<TownMasterFigure />));
  const host = document.createElement("div");
  document.body.append(host);
  const hostRoot = createRoot(host);
  const greet = (world: WorldObject) =>
    flushSync(() =>
      hostRoot.render(
        <TownMasterGreetingHost
          world={world}
          held={false}
          windowsOpen={false}
        />,
      ),
    );
  const greeting = () =>
    document.querySelector<HTMLElement>(".town-master-greeting");
  const apart = (a: Element, b: Element) => {
    const x = a.getBoundingClientRect();
    const y = b.getBoundingClientRect();
    return (
      x.right <= y.left ||
      y.right <= x.left ||
      x.bottom <= y.top ||
      y.bottom <= x.top
    );
  };
  const ready = townWorld({ state: "ready", error: undefined });
  for (const [cardState, title] of [
    ["installed", "Bring your workspace online"],
    ["missing", "Your workspace starts here"],
  ] as const) {
    state = cardState;
    const world = townWorld(failing);
    key++;
    show(world);
    greet(world);
    await waitFor(
      () => card()?.querySelector("h2")?.textContent === title,
      `greeting: the ${cardState} card`,
    );
    await settle();
    const over = greeting();
    check(
      !over || apart(over, card()!),
      `greeting: ${cardState} card and greeting overlap`,
    );
    check(!over, `greeting: waits while the ${cardState} card is up`);
    show(ready);
    greet(ready);
    await settle();
    check(!card(), `greeting: ${cardState} card gone once ready`);
    check(greeting(), `greeting: opens once the ${cardState} card is gone`);
  }
  // A failed default that cannot be set up here (an SSH default, say) shows
  // no card, so nothing holds the greeting back.
  allowed = false;
  const unavailable = townWorld(failing);
  key++;
  show(unavailable);
  greet(unavailable);
  await settle();
  await settle();
  check(!card(), "greeting: no card when setup is unavailable");
  check(greeting(), "greeting: not held when setup is unavailable");
  allowed = true;
  hostRoot.unmount();
  host.remove();
  figureRoot.unmount();
  town.unmount();
}

/** herdr-core first: confirm, then progress, then connected or a plain error. */
async function coreFirst() {
  const postsBefore = posts;
  state = "missing";
  allowed = true;
  statusFailure = false;
  document.documentElement.dataset.theme = "dark";
  key++;
  render();
  await waitFor(() => !!button("Set up herdr-core"), "the core-first card");
  click(primary());
  await waitFor(
    () =>
      document.body.textContent?.includes(
        "Install herdr-core 0.1.22 on this computer?",
      ) === true,
    "the herdr-core confirmation",
  );
  const text = () => document.body.textContent ?? "";
  check(
    text().includes("/home/user/.local/bin/herdr-core"),
    "core: where it goes",
  );
  check(
    text().includes("Starts at login (a systemd user unit)"),
    "core: login start",
  );
  check(text().includes("checked against its SHA-256"), "core: verified");
  check(
    !coreCalls.some((call) => call.action === "install"),
    "core: nothing installs before the confirmation",
  );
  check(
    coreCalls.every((call) => (call.host as { type: string }).type === "local"),
    "core: the Set up card only installs on this computer",
  );
  click(button("Install and start"));
  await waitFor(
    () => text().includes("Installing herdr-core on this computer..."),
    "core progress",
  );
  check(
    document
      .querySelector("[role=log]")
      ?.textContent?.includes("Reading the herdr-core release list"),
    "core: progress lines",
  );
  await waitFor(
    () =>
      text().includes(
        "herdr-core is running on this computer, and World is connected to it.",
      ),
    "core done",
  );
  await checkLogNumbers("core this computer");
  check(posts === postsBefore, "core: the TUI setup is not used");
  // A failure says what went wrong in plain words and can be retried.
  coreCalls.length = 0;
  coreStatusReads = 0;
  coreOutcome = "failed";
  key++;
  render();
  await waitFor(
    () => !!button("Set up herdr-core"),
    "the core-first card again",
  );
  click(primary());
  await waitFor(() => !!button("Install and start"), "the confirmation again");
  click(button("Install and start"));
  await waitFor(
    () =>
      document
        .querySelector("[role=alert]")
        ?.textContent?.includes(
          "Could not set up herdr-core on this computer: the download is damaged (checksum mismatch); try again",
        ) === true,
    "the plain failure",
  );
  check(button("Try again"), "core failure can retry");
  coreOutcome = "done";
}

/** Manage connections: the hosts list, and a core connection that found none. */
async function manageConnections() {
  coreCalls.length = 0;
  coreStatusReads = 0;
  const cores = parseCoreConnections([
    {
      id: "core-dev",
      label: "Dev core",
      type: "ssh",
      ssh_destination: "dev.example.com",
      runtime: "herdr-core",
      state: "error",
      generation: 1,
      core_session: "work",
      core_state_dir: "",
      error: { message: "herdr-core is not running on dev.example.com" },
      observation: null,
    },
  ]);
  flushSync(() =>
    root.render(
      <div className="connection-manager">
        <CoreConnectionCards
          connections={cores}
          pending={null}
          act={() => {}}
          onRemove={() => {}}
        />
      </div>,
    ),
  );
  const hosts = document.querySelector("[aria-label='Install herdr-core']");
  const text = () => document.body.textContent ?? "";
  check(hosts?.textContent?.includes("This computer"), "hosts: this computer");
  check(hosts?.textContent?.includes("dev.example.com"), "hosts: the SSH host");
  check(coreCalls.length === 0, "hosts: nothing is probed until asked");
  // Connecting found no core: the card offers the install under its error.
  const card = document.querySelector("section:not(.core-install-hosts)")!;
  const offer = [...card.querySelectorAll("button")].find(
    (b) => b.textContent === "Install herdr-core…",
  );
  check(offer, "card: a core that is not running offers the install");
  click(offer!);
  await waitFor(
    () => text().includes("Install herdr-core 0.1.22 on dev.example.com?"),
    "the SSH confirmation",
  );
  check(
    text().includes("Herdr at /home/user/.local/bin/herdr stays as it is"),
    "card: the installed TUI stays",
  );
  check(
    text().includes('Starts its "work" session now, then World connects to it'),
    "card: the connection's own session is the one started",
  );
  check(
    !coreCalls.some((call) => call.action === "install"),
    "card: nothing installs before the confirmation",
  );
  click(button("Install and start"));
  await waitFor(
    () =>
      text().includes(
        "herdr-core is running on dev.example.com, and World is connected to it.",
      ),
    "the SSH install finishing",
  );
  await checkLogNumbers("core SSH host");
  check(
    coreCalls.every(
      (call) =>
        (call.host as { destination?: string }).destination ===
        "dev.example.com",
    ),
    "card: only the chosen host is touched",
  );
  check(
    coreCalls
      .filter((call) => call.action !== "status")
      .every((call) => call.connection === "core-dev"),
    "card: probe and install carry the chosen connection",
  );
  click(button("Done"));
  // The hosts list asks first too, and Cancel changes nothing.
  coreCalls.length = 0;
  const local = [...hosts!.querySelectorAll("li")].find((item) =>
    item.textContent?.startsWith("This computer"),
  )!;
  click(local.querySelector("button")!);
  await waitFor(
    () => text().includes("Install herdr-core 0.1.22 on this computer?"),
    "the local confirmation",
  );
  click(button("Cancel"));
  check(
    !document.querySelector("[data-core-install]"),
    "hosts: Cancel closes the step",
  );
  check(
    coreCalls.every((call) => call.action !== "install"),
    "hosts: Cancel installs nothing",
  );
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
    await coreFirst();
    await manageConnections();
    await townPlacement();
  } catch (error) {
    failures.push(String(error));
  }
  await nativeFetch("/result", {
    method: "POST",
    body: JSON.stringify(failures),
  });
}
