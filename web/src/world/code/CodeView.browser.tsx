import { clock as fixtureTime } from "../testing/installTestClock";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../styles/tokens.css";
import "../../styles/base.css";
import type {
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";
import CodeView from "./CodeView";
import { IdeIntegrationsSettings } from "./IdeIntegrationsSettings";
import {
  fixtureIdeClient,
  type IdeClient,
  type IdeInstance,
  type IdeOpenRequest,
  type IdeProviderStatus,
  type IdeStatus,
} from "./ideClient";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const advance = (ms = 80) => fixtureTime.advance(ms);
async function until(condition: () => boolean, message: string, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await advance(30);
  }
  failures.push(message);
  return false;
}
const $ = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
) => root.querySelector<T>(selector);
const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) =>
      entry.textContent?.trim() === label ||
      entry.getAttribute("aria-label") === label,
  );

// Synthetic world: one room on this computer, one over SSH.
const room = (
  id: string,
  connectionId: string,
  hostLabel: string,
  label: string,
  cwd: string,
) =>
  ({
    id,
    kind: "space",
    connectionId,
    generation: 7,
    hostLabel,
    label,
    stale: false,
    children: [],
    workspace: { cwd },
  }) as unknown as WorldSpaceObject;
const leaf = (
  id: string,
  connectionId: string,
  parentId: string,
  cwd: string,
  kind: "agent" | "terminal",
  name: string,
  status: WorldLeafObject["status"] = "idle",
) =>
  ({
    id,
    kind,
    connectionId,
    generation: 7,
    hostLabel: connectionId === "local" ? "This computer" : "devbox",
    parentId,
    label: name,
    agentName: kind === "agent" ? name : undefined,
    stale: false,
    status,
    pane: { cwd, agent: kind === "agent" ? "claude" : undefined },
  }) as unknown as WorldLeafObject;
const world = {
  spaces: [
    room("s-api", "local", "This computer", "api", "/srv/example/api"),
    room("s-docs", "ssh-1", "devbox", "docs", "/srv/example/docs"),
  ],
  leaves: [
    leaf(
      "a-ada",
      "local",
      "s-api",
      "/srv/example/api",
      "agent",
      "ada",
      "blocked",
    ),
    leaf("t-sh", "local", "s-api", "/srv/example/api", "terminal", "shell"),
    leaf("a-bob", "ssh-1", "s-docs", "/srv/example/docs", "agent", "bob"),
  ],
} as unknown as WorldObject;

const INSTANCE_ID = "browserFixture0001";
const SSH_INSTANCE_ID = "browserFixture0002";
function fakeClient() {
  const listeners = new Set<() => void>();
  // Stock VS Code: installed, not enabled; it needs HTTPS or localhost.
  const vscode: IdeProviderStatus = {
    id: "vscode",
    label: "Visual Studio Code",
    marketplace: "Microsoft Marketplace",
    terms: [],
    setupUrl: "https://example.com/download",
    detection: {
      state: "detected",
      path: "/opt/example/bin/code-tunnel",
      version: "1.99.0",
      configured: false,
    },
    needsSecurePage: true,
    enabled: false,
    trustedAt: null,
    termsAcceptedAt: null,
    binary: null,
  };
  const provider = (enabled: boolean): IdeProviderStatus => ({
    id: "code-server",
    label: "code-server",
    marketplace: "Open VSX",
    terms: [
      { label: "Server Terms", url: "https://example.com/terms" },
      { label: "Privacy", url: "https://example.com/privacy" },
    ],
    setupUrl: "https://example.com/download",
    detection: {
      state: "detected",
      path: "/opt/example/bin/code-server",
      version: "4.99.0",
      configured: false,
    },
    needsSecurePage: false,
    enabled,
    trustedAt: null,
    termsAcceptedAt: null,
    binary: null,
  });
  const state = {
    enabled: false,
    instances: [] as IdeInstance[],
    opens: [] as IdeOpenRequest[],
    enables: 0,
    stops: [] as string[],
    // As the service when the host can't be reached: the stop fails and the
    // server stays listed, detached.
    failStop: false,
  };
  const status = (): IdeStatus => ({
    providers: [vscode, provider(state.enabled)],
    instances: state.instances,
    localConnections: ["local"],
  });
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const client: IdeClient = {
    status: async () => status(),
    enable: async () => {
      state.enables++;
      state.enabled = true;
      return status();
    },
    disable: async () => {
      state.enabled = false;
      // As the service: disabling stops none; they stay listed, detached.
      state.instances = state.instances.map((entry) =>
        entry.state === "failed"
          ? entry
          : {
              ...entry,
              state: "detached",
              reason: "code-server is disabled; it still runs.",
            },
      );
      return status();
    },
    configure: async () => status(),
    open: async (request) => {
      state.opens.push(request);
      // An SSH project runs on its host; the frame is still World's /ide/.
      const ssh = request.connectionId !== "local";
      const id = ssh ? SSH_INSTANCE_ID : INSTANCE_ID;
      const instance: IdeInstance = {
        id,
        provider: "code-server",
        connectionId: request.connectionId,
        folder: request.folder,
        state: "starting",
        url: `/ide/${id}/`,
        startedAt: new Date().toISOString(),
        ...(ssh
          ? { sshDestination: "dev@devbox.example" }
          : { downloading: true }),
      };
      state.instances = [
        ...state.instances.filter((entry) => entry.id !== id),
        instance,
      ];
      return { ok: true, instance };
    },
    stop: async (id) => {
      state.stops.push(id);
      state.instances = state.failStop
        ? state.instances.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  state: "detached",
                  reason: "World couldn't stop it. It still runs there.",
                }
              : entry,
          )
        : state.instances.filter((entry) => entry.id !== id);
      return status();
    },
    forget: async (id) => {
      state.instances = state.instances.filter((entry) => entry.id !== id);
      return status();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { client, state, changed, vscode };
}

const box = (selector: string) => $(selector)?.getBoundingClientRect();
const near = (a: number, b: number) => Math.abs(a - b) < 1;

/**
 * VS Code's light/dark follows `prefers-color-scheme` inside its frame: it
 * must answer World's theme (headless Chrome's own is light), and change
 * live, with the change event VS Code listens for.
 */
async function checkFrameTheme(frame: HTMLIFrameElement) {
  const media = frame.contentWindow?.matchMedia("(prefers-color-scheme: dark)");
  if (!media) return check(false, "the workbench frame can be read");
  const themeIs = (theme: "dark" | "light") =>
    until(
      () => media.matches === (theme === "dark"),
      `the workbench frame prefers World's ${theme} theme`,
    );
  let changes = 0;
  media.addEventListener("change", () => changes++);
  document.documentElement.dataset.theme = "dark";
  await themeIs("dark");
  document.documentElement.dataset.theme = "light";
  await themeIs("light");
  await until(() => changes > 0, "VS Code hears World's theme change");
  document.documentElement.dataset.theme = "dark";
  await themeIs("dark");
}

async function run() {
  localStorage.clear();
  const host = document.getElementById("root")!;
  host.style.height = "640px";
  const root = createRoot(host);
  const fake = fakeClient();
  const agents: string[] = [];
  const terminals: string[] = [];
  flushSync(() =>
    root.render(
      <CodeView
        world={world}
        client={fake.client}
        onOpenAgent={(id) => agents.push(id)}
        onOpenTerminal={(id) => terminals.push(id)}
      />,
    ),
  );
  await until(
    () => Boolean($('.ide-provider[data-provider="code-server"] button')),
    "the Code view lists the IDE integrations",
  );
  // Stock VS Code can be enabled; its HTTPS need is said up front.
  const vscodeRow = $('.ide-provider[data-provider="vscode"]')!;
  check(
    vscodeRow.querySelector(".ide-provider-badge")?.textContent ===
      "Installed · 1.99.0" && Boolean(button("Enable…", vscodeRow)),
    "stock VS Code reads Installed and offers Enable",
  );
  check(
    vscodeRow.textContent?.includes("opens only when World is on HTTPS") ===
      true,
    "stock VS Code says it needs HTTPS or localhost",
  );
  check(
    !/desktop/i.test($(".code-view")?.textContent ?? "") &&
      !document.querySelector('a[href^="vscode:"]'),
    "nothing in the Code view opens a desktop IDE",
  );
  check(
    $(".code-view-where")?.textContent?.includes("/srv/example/api") === true,
    "the first live project on this computer is chosen",
  );

  // The rail starts folded on a window narrower than 1100 px.
  const toggle = button("Agents and terminals")!;
  check(
    Boolean(toggle) &&
      toggle.getAttribute("aria-expanded") === "false" &&
      !$(".code-view-context"),
    "the rail starts collapsed on a narrow window",
  );
  check(
    toggle?.querySelector(".code-view-rail-count")?.textContent === "2",
    "the folded rail shows how many agents and terminals it holds",
  );
  toggle?.click();
  await until(
    () => Boolean($(".code-view-context")),
    "the toggle opens the rail",
  );
  check(
    toggle?.getAttribute("aria-expanded") === "true" &&
      $(".code-view-context")?.id === toggle.getAttribute("aria-controls"),
    "the toggle says the rail is open and which element it controls",
  );
  // The rail: the project's agent and terminal, not the other host's.
  const rail = $(".code-view-context")!;
  check(
    rail.textContent?.includes("ada") === true &&
      rail.textContent.includes("shell") &&
      !rail.textContent.includes("bob"),
    "the rail lists only this project's agents and terminals",
  );
  check(
    rail.textContent?.includes("Needs you") === true,
    "a blocked agent reads Needs you",
  );
  [...rail.querySelectorAll<HTMLButtonElement>(".code-view-leaf")]
    .find((entry) => entry.textContent?.includes("ada"))
    ?.click();
  [...rail.querySelectorAll<HTMLButtonElement>(".code-view-leaf")]
    .find((entry) => entry.textContent?.includes("shell"))
    ?.click();
  check(
    agents.join() === "a-ada" && terminals.join() === "t-sh",
    "rail clicks open the agent's Chat and the terminal",
  );

  // The gate: Enable stays off until both boxes are ticked.
  const serverRow = $('.ide-provider[data-provider="code-server"]')!;
  button("Enable…", serverRow)!.click();
  await until(() => Boolean($(".ide-gate")), "Enable… opens the gate");
  const gate = $(".ide-gate")!;
  const enable = button("Enable", gate)!;
  check(
    gate.textContent?.includes("SSH host") === true &&
      gate.textContent.includes("Full access to those computers") &&
      gate.textContent.includes("Full access to World") &&
      gate.textContent.includes("Open VSX"),
    "the gate discloses host and World authority and the marketplace",
  );
  check(
    gate.querySelector('a[href="https://example.com/terms"]') !== null,
    "the gate links the provider's terms",
  );
  const boxes = [
    ...gate.querySelectorAll<HTMLInputElement>(".ide-gate-check input"),
  ];
  check(boxes.length === 2, "trust and terms are two separate boxes");
  check(enable.disabled, "Enable starts off");
  boxes[0]!.click();
  await advance();
  check(button("Enable", gate)!.disabled, "trust alone does not enable");
  boxes[1]!.click();
  await advance();
  check(!button("Enable", gate)!.disabled, "both boxes enable Enable");
  button("Enable", gate)!.click();
  await until(() => !$(".ide-gate"), "the gate closes once enabled");
  check(fake.state.enables === 1, "Enable calls the service once");

  // Open: starting (first download), then ready in a same-origin frame.
  const openButton = await until(
    () => Boolean(button("Open in code-server")),
    "an enabled IDE offers Open for the project",
  );
  if (openButton) button("Open in code-server")!.click();
  await until(
    () =>
      $(".code-view-starting")?.textContent?.includes(
        "getting its server ready",
      ) === true,
    "a first start shows the download notice",
  );
  const request = fake.state.opens[0];
  check(
    request?.connectionId === "local" &&
      request.generation === 7 &&
      request.folder === "/srv/example/api",
    "open is qualified by connection, generation and folder",
  );
  fake.state.instances = fake.state.instances.map((entry) => ({
    ...entry,
    state: "ready",
    downloading: undefined,
  }));
  fake.changed();
  const framed = await until(
    () => Boolean($<HTMLIFrameElement>('.code-view-frame[data-front="true"]')),
    "a ready server shows in the frame",
  );
  if (framed) {
    const frame = $<HTMLIFrameElement>(".code-view-frame")!;
    check(
      frame.getAttribute("src") === `/ide/${INSTANCE_ID}/`,
      "the frame stays on World's origin under /ide/",
    );
    await until(
      () =>
        frame.contentDocument?.body?.textContent?.includes("fake workbench") ===
        true,
      "the proxied workbench loads in the frame",
    );
    await checkFrameTheme(frame);
    check(
      $<HTMLAnchorElement>(
        'a.code-view-bar-action[target="_blank"]',
      )?.getAttribute("href") === `/ide/${INSTANCE_ID}/`,
      "New tab opens the same address",
    );
    // Edge to edge: only a thin bar above; the rail beside it folds away.
    const view = box(".code-view")!;
    const bar = box(".code-view-bar")!;
    const withRail = frame.getBoundingClientRect();
    check(
      bar.height <= 36 &&
        near(withRail.left, view.left) &&
        near(withRail.bottom, view.bottom) &&
        near(withRail.top, bar.bottom),
      `the workbench fills the view under a thin bar (bar ${bar.height}px)`,
    );
    button("Agents and terminals")!.click();
    await until(() => !$(".code-view-context"), "the toggle folds the rail");
    const folded = frame.getBoundingClientRect();
    check(
      near(folded.width, view.width) && folded.width > withRail.width,
      "with the rail folded the workbench takes the full width",
    );
    button("Agents and terminals")!.click();
    await until(() => Boolean($(".code-view-context")), "the rail opens again");
  }

  // Switching to the SSH project: VS Code runs on that host and shows
  // here; the loaded frame stays mounted (hidden) for coming back.
  const select = $<HTMLSelectElement>(".code-view-project select")!;
  const docs = [...select.options].find((option) =>
    option.textContent?.includes("docs"),
  )!;
  select.value = docs.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await advance();
  check(
    $(".code-view-context")?.textContent?.includes("bob") === true,
    "the rail follows the chosen project",
  );
  check(
    $(".code-view-frame")?.getAttribute("data-front") === "false",
    "the other project's frame is hidden, not reloaded",
  );
  check(
    $(".code-view-closed")?.textContent?.includes(
      "On devbox, over SSH: World starts code-server there",
    ) === true,
    "an SSH project says its IDE runs on that host",
  );
  button("Open in code-server")?.click();
  await until(
    () =>
      $(".code-view-starting")?.textContent?.includes("on devbox, over SSH") ===
      true,
    "an SSH project starts its IDE on the host",
  );
  check(
    fake.state.opens[1]?.connectionId === "ssh-1" &&
      fake.state.opens[1].folder === "/srv/example/docs",
    "the SSH open names that connection and folder",
  );
  fake.state.instances = fake.state.instances.map((entry) => ({
    ...entry,
    state: "ready",
  }));
  fake.changed();
  await until(
    () =>
      $<HTMLIFrameElement>('.code-view-frame[data-front="true"]')?.getAttribute(
        "src",
      ) === `/ide/${SSH_INSTANCE_ID}/`,
    "the SSH host's IDE shows in a frame on World's origin",
  );
  check(localStorage.length > 0, "the chosen project is remembered");

  // Back to api: the frame shows again; Stop asks first.
  select.value = [...select.options].find((option) =>
    option.textContent?.includes("api"),
  )!.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await advance();
  check(
    $<HTMLIFrameElement>('.code-view-frame[data-front="true"]')?.getAttribute(
      "src",
    ) === `/ide/${INSTANCE_ID}/`,
    "coming back shows the same loaded frame",
  );
  button("Stop")?.click();
  await until(() => Boolean($(".modal[role=dialog]")), "Stop asks first");
  check(
    $(".modal[role=dialog]")?.textContent?.includes(
      "Everything running in it ends with it: its terminals, tasks",
    ) === true,
    "Stop says what ends with the server",
  );
  const actions = [
    ...document.querySelectorAll<HTMLButtonElement>(".modal-actions button"),
  ];
  const confirm = actions[actions.length - 1];
  confirm?.click();
  await until(
    () => fake.state.stops.join() === INSTANCE_ID,
    "Stop stops this server",
  );
  await until(
    () => !$(`.code-view-frame[src="/ide/${INSTANCE_ID}/"]`),
    "a stopped server's frame goes away",
  );

  // The SSH link drops: World lets go, the server runs on and is listed.
  const sshFrame = $<HTMLIFrameElement>(
    `.code-view-frame[src="/ide/${SSH_INSTANCE_ID}/"]`,
  );
  const startedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  fake.state.instances = fake.state.instances.map((entry) => ({
    ...entry,
    state: "detached",
    startedAt,
    reason:
      "SSH to devbox dropped; the IDE still runs there. Open it to reconnect.",
  }));
  fake.changed();
  const serversButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent?.startsWith("Servers"),
    );
  await until(
    () =>
      serversButton()?.querySelector(".code-view-rail-count")?.textContent ===
      "1",
    "the bar counts the IDE servers that still run",
  );
  serversButton()?.click();
  await until(
    () => Boolean($('[aria-label="Running IDE servers"] .ide-server')),
    "Servers lists every IDE server World started that still runs",
  );
  const listed =
    $('[aria-label="Running IDE servers"] .ide-server') ?? document.body;
  check(
    listed.textContent?.includes("/srv/example/docs") === true &&
      listed.textContent.includes("code-server on devbox") &&
      listed.textContent.includes("since ") &&
      listed.textContent.includes("Running, not attached"),
    `a listed server names its folder, host, since-when and state: ${listed.textContent}`,
  );
  check(
    Boolean(button("Stop the IDE for /srv/example/docs", listed)),
    "a listed server offers Stop",
  );
  button("Show", listed)?.click();
  await until(
    () =>
      $(".code-view-detached")?.textContent?.includes(
        "code-server still runs on devbox",
      ) === true,
    "a detached server's project says it still runs there",
  );
  check(
    !$(".code-view-servers") &&
      $(".code-view-detached")?.textContent?.includes(
        "Open it to reconnect",
      ) === true,
    "Show brings its project to the front with the reason",
  );
  button("Open", $(".code-view-detached")!)?.click();
  await until(
    () => fake.state.opens.length === 3,
    "Open on a detached server asks World to reattach",
  );
  check(
    fake.state.opens[2]?.connectionId === "ssh-1" &&
      fake.state.opens[2].folder === "/srv/example/docs",
    "reattaching names the same connection and folder",
  );
  // While World reattaches, the loaded workbench stays loaded behind (#1262):
  // VS Code reconnects in it; the same frame comes back, not a new load.
  check(
    Boolean(sshFrame) &&
      $(`.code-view-frame[src="/ide/${SSH_INSTANCE_ID}/"]`) === sshFrame &&
      sshFrame?.getAttribute("data-front") === "false",
    "a detached server's loaded workbench stays mounted behind",
  );
  fake.state.instances = fake.state.instances.map((entry) => ({
    ...entry,
    state: "ready",
    reason: undefined,
  }));
  fake.changed();
  await until(
    () =>
      $<HTMLIFrameElement>('.code-view-frame[data-front="true"]') ===
        sshFrame && sshFrame !== null,
    "reattached, the same workbench frame is in front again",
  );
  check(
    !$(".code-view-reloaded"),
    "a reattached workbench didn't load again, so nothing says it did",
  );

  // A Stop that fails (the host can't be reached) leaves the server
  // running: its loaded workbench stays, the same frame (#1262).
  fake.state.failStop = true;
  button("Stop")?.click();
  await until(() => Boolean($(".modal[role=dialog]")), "Stop asks first");
  const failedActions = [
    ...document.querySelectorAll<HTMLButtonElement>(".modal-actions button"),
  ];
  failedActions[failedActions.length - 1]?.click();
  await until(
    () => fake.state.stops.includes(SSH_INSTANCE_ID),
    "Stop asks World to stop the SSH server",
  );
  await advance();
  check(
    $(`.code-view-frame[src="/ide/${SSH_INSTANCE_ID}/"]`) === sshFrame,
    "a Stop that failed keeps the still-running server's workbench loaded",
  );
  fake.state.failStop = false;
  flushSync(() => root.unmount());

  // Microsoft's VS Code on a plain-HTTP address: World says why and what to
  // do instead of a workbench that waits forever, even when it runs.
  localStorage.clear();
  const plain = createRoot(host);
  const ready: IdeInstance = {
    id: "browserFixture0003",
    provider: "vscode",
    connectionId: "local",
    folder: "/srv/example/api",
    state: "ready",
    url: "/ide/browserFixture0003/",
    startedAt: new Date().toISOString(),
  };
  let insecureReads = 0;
  const insecureClient: IdeClient = {
    ...fake.client,
    status: async () => {
      insecureReads++;
      return {
        providers: [{ ...fake.vscode, enabled: true }],
        instances: [ready],
        localConnections: ["local"],
      };
    },
  };
  flushSync(() =>
    plain.render(
      <CodeView
        world={world}
        client={insecureClient}
        secure={false}
        onOpenAgent={() => {}}
        onOpenTerminal={() => {}}
      />,
    ),
  );
  await until(
    () => $(".code-view")?.getAttribute("data-state") === "insecure-page",
    "VS Code on a plain-HTTP page shows why it can't open",
  );
  const insecureText = $(".code-view-panel")?.textContent ?? "";
  check(
    insecureText.includes("needs a secure address") &&
      insecureText.includes("HTTPS") &&
      insecureText.includes("tailscale serve") &&
      insecureText.includes("localhost"),
    "the refusal says what to do: HTTPS or localhost",
  );
  check(
    !$(".code-view-frame") &&
      !$('a.code-view-bar-action[target="_blank"]') &&
      !button("Open in Visual Studio Code") &&
      Boolean(button("Stop")),
    "no workbench or New tab that would wait forever; Stop stays",
  );
  check(
    insecureText.includes("It can run on the computer World runs on"),
    "the secure-address screen names the project's computer",
  );
  check(
    Boolean(button("Try again")) && Boolean(button("Choose another IDE")),
    "the secure-address screen offers Try again and Choose another IDE",
  );
  const readsBeforeRetry = insecureReads;
  button("Try again")?.click();
  await until(
    () => insecureReads > readsBeforeRetry,
    "Try again on the secure-address screen checks again",
  );
  await advance();
  check(
    $(".code-view")?.getAttribute("data-state") === "insecure-page" &&
      !$(".code-view-frame") &&
      button("Try again")?.disabled === false,
    "checking again on the same plain-HTTP address still explains why",
  );
  button("Choose another IDE")?.click();
  await until(
    () =>
      Boolean(
        button(
          "Disable",
          $('[aria-label="IDEs"] [data-provider="vscode"]') ?? document.body,
        ),
      ),
    "Choose another IDE on the secure-address screen opens the IDE list",
  );
  flushSync(() => plain.unmount());

  await checkShowPicksServer(host, fake);
  await checkFailures(host);

  // Settings shows the same rows.
  const settings = createRoot(host);
  flushSync(() =>
    settings.render(<IdeIntegrationsSettings client={fake.client} />),
  );
  await until(
    () =>
      $(
        '[aria-label="IDE integrations"] [data-provider="code-server"] .ide-provider-badge',
      )?.textContent?.startsWith("Enabled") === true,
    "Settings lists the enabled IDE",
  );
  check(
    $('[aria-label="Running IDE servers"]')?.textContent?.includes(
      "/srv/example/docs",
    ) === true,
    "Settings lists the IDE servers that still run",
  );
  // Disable stops none: it lists them first, each with its own Stop.
  const stopsBeforeDisable = fake.state.stops.length;
  button(
    "Disable",
    $('[aria-label="IDE integrations"] [data-provider="code-server"]')!,
  )?.click();
  await until(
    () =>
      $(".modal[role=dialog]")?.textContent?.includes(
        "Its IDE server keeps running and stays listed until you stop it.",
      ) === true &&
      $(".modal[role=dialog] .ide-server-list")?.textContent?.includes(
        "/srv/example/docs",
      ) === true,
    "Disable lists the running server, which it does not stop",
  );
  const disableActions = [
    ...document.querySelectorAll<HTMLButtonElement>(".modal-actions button"),
  ];
  disableActions[disableActions.length - 1]?.click();
  await until(
    () =>
      !fake.state.enabled &&
      !$(".modal[role=dialog]") &&
      $(".ide-servers")?.textContent?.includes("/srv/example/docs") === true,
    "confirming Disable keeps its servers running and listed",
  );
  check(
    fake.state.stops.length === stopsBeforeDisable,
    "Disable stopped a server",
  );
  flushSync(() => settings.unmount());
}

/**
 * Servers → Show brings the listed server to the front, even when another
 * IDE was picked for that project and has no server there.
 */
async function checkShowPicksServer(
  host: HTMLElement,
  fake: ReturnType<typeof fakeClient>,
) {
  localStorage.clear();
  const [, codeServer] = (await fake.client.status()).providers;
  const running: IdeInstance = {
    id: "browserFixture0004",
    provider: "code-server",
    connectionId: "local",
    folder: "/srv/example/api",
    state: "ready",
    url: "/ide/browserFixture0004/",
    startedAt: new Date().toISOString(),
  };
  const client: IdeClient = {
    ...fake.client,
    status: async () => ({
      providers: [
        { ...fake.vscode, enabled: true },
        { ...codeServer!, enabled: true },
      ],
      instances: [running],
      localConnections: ["local"],
    }),
  };
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <CodeView
        world={world}
        client={client}
        secure
        onOpenAgent={() => {}}
        onOpenTerminal={() => {}}
      />,
    ),
  );
  const shown = () =>
    $<HTMLIFrameElement>('.code-view-frame[data-front="true"]')?.getAttribute(
      "src",
    ) === running.url;
  await until(shown, "the running code-server shows before any IDE is picked");
  const picker = $<HTMLSelectElement>(".code-view-provider select");
  check(Boolean(picker), "two enabled IDEs show the IDE picker");
  if (picker) {
    picker.value = "vscode";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await until(
    () => Boolean(button("Open in Visual Studio Code")) && !shown(),
    "picking another IDE offers Open in it",
  );
  [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent?.startsWith("Servers"))
    ?.click();
  await until(
    () => Boolean($('[aria-label="Running IDE servers"] .ide-server')),
    "Servers lists the running code-server",
  );
  button("Show", $('[aria-label="Running IDE servers"] .ide-server')!)?.click();
  await until(
    shown,
    "Show brings the listed code-server to the front, not the picked IDE",
  );
  check(
    $<HTMLSelectElement>(".code-view-provider select")?.value === "code-server",
    "Show selects the listed server's IDE",
  );
  flushSync(() => root.unmount());
}

/** The fixture client, told which connection is World's own computer. */
function onThisComputer(client: IdeClient): IdeClient {
  const local = (status: IdeStatus) => ({
    ...status,
    localConnections: ["local"],
  });
  return {
    ...client,
    status: async (refresh) => local(await client.status(refresh)),
    enable: async (id) => local(await client.enable(id)),
    disable: async (id) => local(await client.disable(id)),
  };
}

const ideList = () => $('[aria-label="IDEs"]');
const ideRow = (id: string) => $(`[aria-label="IDEs"] [data-provider="${id}"]`);

/**
 * Every failure says what went wrong and where, and offers Try again and
 * Choose another IDE, which shows the IDE list without leaving Code.
 */
async function checkFailures(host: HTMLElement) {
  const mount = (client: IdeClient) => {
    localStorage.clear();
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <CodeView
          world={world}
          client={client}
          onOpenAgent={() => {}}
          onOpenTerminal={() => {}}
        />,
      ),
    );
    return root;
  };
  const failureActions = (where: string) => {
    check(
      Boolean(button("Try again")) && Boolean(button("Choose another IDE")),
      `${where} offers Try again and Choose another IDE`,
    );
  };

  // Only OpenVSCode Server is enabled and it isn't installed: refused.
  const opens: IdeOpenRequest[] = [];
  const notInstalled = onThisComputer(fixtureIdeClient("not-installed"));
  const recording: IdeClient = {
    ...notInstalled,
    open: async (request) => {
      opens.push(request);
      return notInstalled.open(request);
    },
  };
  let root = mount(recording);
  await until(
    () => Boolean(button("Open in OpenVSCode Server")),
    "an enabled IDE that isn't installed still offers Open",
  );
  check(
    Boolean(button("IDEs")),
    "the bar keeps the IDE list one click away once an IDE is enabled",
  );
  button("Open in OpenVSCode Server")?.click();
  await until(
    () => $(".code-view")?.getAttribute("data-state") === "refused",
    "opening an IDE that isn't installed is refused",
  );
  const refusal = $(".code-view-refusal")?.textContent ?? "";
  check(
    refusal.includes(
      "OpenVSCode Server isn't installed on the computer World runs on",
    ) && refusal.includes("World never installs an IDE"),
    `the refusal names the IDE and the computer: ${refusal}`,
  );
  failureActions("the not-installed refusal");
  button("Try again")?.click();
  await until(() => opens.length === 2, "Try again opens again");
  await advance();
  check(
    $(".code-view")?.getAttribute("data-state") === "refused",
    "trying again refuses the same way",
  );
  button("Choose another IDE")?.click();
  await until(
    () => Boolean(ideRow("openvscode")),
    "Choose another IDE shows the IDE list",
  );
  check(
    ideRow("openvscode")?.textContent?.includes(
      "opens only on a computer where it is installed",
    ) === true,
    "a row that isn't installed says it opens only where it is installed",
  );
  check(
    $(".code-view-refusal") !== null,
    "the failure stays beneath the list: Code doesn't navigate away",
  );
  button("Disable", ideRow("openvscode")!)?.click();
  await until(
    () => Boolean(button("Enable…", ideRow("openvscode") ?? document.body)),
    "the list disables the IDE that isn't installed",
  );
  button("Enable…", ideRow("code-server")!)?.click();
  await until(() => Boolean($(".ide-gate")), "Enable… opens the gate");
  $<HTMLInputElement>(".ide-gate .ide-gate-check input")?.click();
  await advance();
  button("Enable", $(".ide-gate")!)?.click();
  await until(
    () => !$(".ide-gate") && Boolean(button("Open in code-server")),
    "enabling another IDE replaces the refusal with Open in it",
  );
  button("Close", ideList()!)?.click();
  await until(() => !ideList(), "the IDE list closes");
  button("Open in code-server")?.click();
  await until(
    () => opens[2]?.provider === "code-server",
    "the other IDE opens the project",
  );
  flushSync(() => root.unmount());

  // The server stopped: why, on which computer, and the way on.
  root = mount(onThisComputer(fixtureIdeClient("failed")));
  await until(
    () => Boolean(button("Open in code-server")),
    "the failed fixture offers Open",
  );
  button("Open in code-server")?.click();
  await until(
    () => Boolean($(".code-view-failed")),
    "a server that exits shows the failure",
  );
  const failed = $(".code-view-failed")?.textContent ?? "";
  check(
    failed.includes("code-server stopped on the computer World runs on") &&
      failed.includes("could not bind its socket"),
    `the failure says what stopped, where and why: ${failed}`,
  );
  failureActions("a stopped server");
  button("Choose another IDE")?.click();
  await until(
    () => Boolean(ideRow("vscode")),
    "Choose another IDE after a stopped server shows the IDE list",
  );
  flushSync(() => root.unmount());

  // Any other refusal: World can't open it here, on that computer.
  const ssh = fixtureIdeClient("ssh");
  root = mount(
    onThisComputer({
      ...ssh,
      open: async () => ({
        ok: false,
        refusal: {
          code: "windows",
          message:
            "World can't run a web IDE server on devbox, a Windows host, yet.",
        },
      }),
    }),
  );
  await until(
    () => Boolean(button("Open in code-server")),
    "the refused project offers Open",
  );
  const select = $<HTMLSelectElement>(".code-view-project select")!;
  select.value = [...select.options].find((option) =>
    option.textContent?.includes("docs"),
  )!.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await advance();
  button("Open in code-server")?.click();
  await until(
    () => $(".code-view-refusal")?.getAttribute("data-code") === "windows",
    "a Windows host is refused",
  );
  check(
    $(".code-view-refusal h2")?.textContent ===
      "World can't open docs in code-server on devbox",
    `the refusal names the project, IDE and computer: ${$(".code-view-refusal h2")?.textContent}`,
  );
  failureActions("a refusal");
  button("Choose another IDE")?.click();
  await until(
    () => Boolean(ideRow("code-server")),
    "Choose another IDE after a refusal shows the IDE list",
  );
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
