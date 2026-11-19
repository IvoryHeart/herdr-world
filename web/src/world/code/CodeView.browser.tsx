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
import type {
  IdeClient,
  IdeInstance,
  IdeOpenRequest,
  IdeProviderStatus,
  IdeStatus,
} from "./ideClient";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, message: string, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await settle(30);
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
function fakeClient() {
  const listeners = new Set<() => void>();
  // Stock VS Code is installed but desktop only; code-server embeds.
  const desktop: IdeProviderStatus = {
    id: "vscode",
    label: "Visual Studio Code",
    marketplace: "Microsoft Marketplace",
    terms: [],
    setupUrl: "https://example.com/download",
    detection: {
      state: "detected",
      path: "/opt/example/bin/code",
      version: "1.99.0",
      configured: false,
    },
    oneOrigin: false,
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
    oneOrigin: true,
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
  };
  const status = (): IdeStatus => ({
    providers: [desktop, provider(state.enabled)],
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
      return status();
    },
    configure: async () => status(),
    open: async (request) => {
      state.opens.push(request);
      if (request.provider === "vscode")
        return {
          ok: false,
          refusal: {
            code: "origin",
            message: "VS Code loads extension views from another origin.",
            handoff: {
              command: `code '${request.folder}'`,
              url: `vscode://file${request.folder}`,
            },
          },
        };
      if (request.connectionId !== "local")
        return {
          ok: false,
          refusal: {
            code: "remote",
            message: "This project is on devbox, over SSH.",
            handoff: {
              command: `code --remote ssh-remote+devbox.example '${request.folder}'`,
              url: `vscode://vscode-remote/ssh-remote+devbox.example${request.folder}`,
            },
          },
        };
      const instance: IdeInstance = {
        id: INSTANCE_ID,
        provider: "code-server",
        connectionId: request.connectionId,
        folder: request.folder,
        state: "starting",
        url: `/ide/${INSTANCE_ID}/`,
        startedAt: new Date().toISOString(),
        downloading: true,
      };
      state.instances = [instance];
      return { ok: true, instance };
    },
    stop: async (id) => {
      state.stops.push(id);
      state.instances = [];
      return status();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { client, state, changed };
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
    () => Boolean(button("Enable…")),
    "a detected, disabled code-server offers Enable… in the Code view",
  );
  // Stock VS Code: desktop only, with a handoff and no Enable.
  const vscodeRow = $('.ide-provider[data-provider="vscode"]')!;
  check(
    vscodeRow.querySelector(".ide-provider-badge")?.textContent ===
      "Desktop only · 1.99.0" && !button("Enable…", vscodeRow),
    "stock VS Code reads Desktop only and offers no Enable",
  );
  const desktopOpen = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".code-view-desktop button",
    ),
  ].find((entry) => entry.textContent?.includes("desktop Visual Studio Code"));
  check(Boolean(desktopOpen), "the Code view offers desktop VS Code");
  desktopOpen?.click();
  await until(
    () => Boolean($(".code-view-refusal[data-code=origin]")),
    "desktop VS Code answers with a handoff",
  );
  check(
    $<HTMLAnchorElement>(".code-view-handoff a")?.getAttribute("href") ===
      "vscode://file/srv/example/api" &&
      fake.state.opens.shift()?.provider === "vscode",
    "the handoff opens the project in desktop VS Code",
  );
  check(
    $(".code-view-where")?.textContent?.includes("/srv/example/api") === true,
    "the first live project on this computer is chosen",
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
  button("Enable…")!.click();
  await until(() => Boolean($(".ide-gate")), "Enable… opens the gate");
  const gate = $(".ide-gate")!;
  const enable = button("Enable", gate)!;
  check(
    gate.textContent?.includes("Full access to this computer") === true &&
      gate.textContent.includes("Full access to World") &&
      gate.textContent.includes("Open VSX"),
    "the gate discloses machine and World authority and the marketplace",
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
  await settle();
  check(button("Enable", gate)!.disabled, "trust alone does not enable");
  boxes[1]!.click();
  await settle();
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
  fake.state.instances = [
    { ...fake.state.instances[0]!, state: "ready", downloading: undefined },
  ];
  fake.changed();
  const framed = await until(
    () => Boolean($<HTMLIFrameElement>(".code-view-frame:not([hidden])")),
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
    check(
      $<HTMLAnchorElement>(
        'a.code-view-bar-action[target="_blank"]',
      )?.getAttribute("href") === `/ide/${INSTANCE_ID}/`,
      "New tab opens the same address",
    );
  }

  // Switching to the SSH project: a refusal with the Remote-SSH handoff,
  // and the loaded frame stays mounted (hidden) for coming back.
  const select = $<HTMLSelectElement>(".code-view-project select")!;
  const docs = [...select.options].find((option) =>
    option.textContent?.includes("docs"),
  )!;
  select.value = docs.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check(
    $(".code-view-context")?.textContent?.includes("bob") === true,
    "the rail follows the chosen project",
  );
  check(
    $(".code-view-frame")?.hasAttribute("hidden") === true,
    "the other project's frame is hidden, not reloaded",
  );
  check(
    Boolean(button("Open in desktop VS Code…")),
    "an SSH project says up front it opens in desktop VS Code",
  );
  button("Open in desktop VS Code…")?.click();
  await until(
    () => Boolean($(".code-view-refusal[data-code=remote]")),
    "an SSH project is refused with a handoff",
  );
  check(
    $(".code-view-command code")?.textContent ===
      "code --remote ssh-remote+devbox.example '/srv/example/docs'",
    "the handoff names the folder and SSH destination",
  );
  check(
    $<HTMLAnchorElement>(".code-view-handoff a")?.getAttribute("href") ===
      "vscode://vscode-remote/ssh-remote+devbox.example/srv/example/docs",
    "the handoff link opens desktop VS Code",
  );
  check(localStorage.length > 0, "the chosen project is remembered");

  // Back to api: the frame shows again; Stop asks first.
  select.value = [...select.options].find((option) =>
    option.textContent?.includes("api"),
  )!.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check(
    $(".code-view-frame")?.hasAttribute("hidden") === false,
    "coming back shows the same loaded frame",
  );
  button("Stop")?.click();
  await until(() => Boolean($(".modal[role=dialog]")), "Stop asks first");
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
    () => !$(".code-view-frame"),
    "a stopped server's frame goes away",
  );
  flushSync(() => root.unmount());

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
  flushSync(() => settings.unmount());
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
