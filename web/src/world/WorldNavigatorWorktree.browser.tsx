// Worktree entry points in the World navigator, on repository workspaces:
// desktop (right-click) and phone (long-press), and a stale host whose tree
// shows them but stays inert. The page renders the real navigator from a
// parsed World observation, as the service sends it.
import { createRoot } from "react-dom/client";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { parseWorldSnapshotResult } from "./runtimeStore";
import { WorldNavigator } from "./WorldNavigator";
import { buildWorldObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

const phone = new URLSearchParams(location.search).get("mode") === "phone";
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
window.addEventListener("error", (event) =>
  failures.push(`Uncaught browser error: ${event.message}`),
);

const zero = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
// Herdr reports worktree metadata for the workspaces it opened as worktrees.
const worktree = (checkoutPath: string, linked: boolean) => ({
  repo_key: "repo:studio",
  repo_name: "studio",
  repo_root: "/srv/studio",
  checkout_path: checkoutPath,
  is_linked_worktree: linked,
});
const workspace = (
  workspaceId: string,
  number: number,
  focused: boolean,
  tree?: ReturnType<typeof worktree>,
) => ({
  workspace_id: workspaceId,
  number,
  label: workspaceId,
  focused,
  pane_count: 0,
  tab_count: 0,
  agent_status: "idle",
  ...(tree ? { worktree: tree } : {}),
});
const host = (
  connectionId: string,
  label: string,
  stale: boolean,
  workspaces: ReturnType<typeof workspace>[],
) => ({
  connection_id: connectionId,
  label,
  source: "test",
  is_default: !stale,
  state: stale ? "reconnecting" : "ready",
  generation: 7,
  snapshot_generation: 7,
  stale,
  actionable: !stale,
  snapshot: {
    workspaces,
    tabs: [],
    panes: [],
    agents: [],
    coverage: {
      workspaces: workspaces.length,
      tabs: 0,
      panes: 0,
      agent_panes: 0,
      status: zero,
      by_workspace: workspaces.map(({ workspace_id }) => ({
        workspace_id,
        tabs: 0,
        panes: 0,
        agent_panes: 0,
        status: zero,
      })),
    },
  },
});

const observation = parseWorldSnapshotResult({
  revision: 1,
  observed_at: Date.now(),
  connections: [
    host("alpha", "Alpha", false, [
      workspace("studio", 1, false, worktree("/srv/studio", false)),
      workspace("studio-login", 2, true, worktree("/srv/trees/login", true)),
      workspace("notes", 3, false),
    ]),
    // A failed host's cached topology: still shown, never actionable.
    host("beta", "Beta", true, [
      workspace("beta-login", 1, true, worktree("/srv/trees/beta", true)),
    ]),
  ],
});
check(observation?.connections.length === 2, "the observation did not parse");

initializeLayoutPreferences();
const mount = document.createElement("main");
document.body.append(mount);
createRoot(mount).render(
  <WorldNavigator
    world={buildWorldObject(observation?.connections ?? [], null)}
    onSelect={() => {}}
  />,
);

const settle = (ms = 0) =>
  new Promise((resolve) =>
    setTimeout(() => requestAnimationFrame(() => resolve(undefined)), ms),
  );
const tree = (connectionId: string) =>
  document.querySelector<HTMLElement>(
    `[data-world-navigator-host="${connectionId}"] .world-navigator-tree`,
  );
const row = (container: HTMLElement | null, label: string) =>
  [
    ...(container?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []),
  ].find(
    (item) => item.querySelector(".ws-label")?.textContent?.trim() === label,
  );
const visible = (element: Element | null | undefined) => {
  const rect = element?.getBoundingClientRect();
  return (
    !!rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth
  );
};

async function menuFor(item: HTMLElement | undefined): Promise<string[]> {
  if (!item) return [];
  const rect = item.getBoundingClientRect();
  const at = { clientX: rect.left + 12, clientY: rect.top + rect.height / 2 };
  if (phone) {
    // A touch long-press opens the same menu as a desktop right-click.
    item.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...at,
        bubbles: true,
        pointerType: "touch",
      }),
    );
    await settle(700);
    item.dispatchEvent(
      new PointerEvent("pointerup", {
        ...at,
        bubbles: true,
        pointerType: "touch",
      }),
    );
  } else {
    item.dispatchEvent(
      new MouseEvent("contextmenu", { ...at, bubbles: true, cancelable: true }),
    );
  }
  await settle();
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>(".context-menu-item"),
  ];
  check(
    buttons.length === 0 || buttons.every(visible),
    `a menu entry is outside the ${phone ? "phone" : "desktop"} viewport`,
  );
  const labels = buttons.map((button) => button.textContent?.trim() ?? "");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  return labels;
}

async function run() {
  await settle(50);
  check(
    document.documentElement.dataset.layout === (phone ? "mobile" : "desktop"),
    `layout is ${document.documentElement.dataset.layout}, not ${phone ? "mobile" : "desktop"}`,
  );
  const alpha = tree("alpha");
  const beta = tree("beta");
  check(alpha && !alpha.inert, "the ready host's tree is missing or inert");

  // The focused worktree workspace puts the lifecycle button in the panel head.
  const button = alpha?.querySelector<HTMLButtonElement>(
    '[aria-label="Open worktree lifecycle"]',
  );
  check(visible(button), "the Worktree lifecycle button is not visible");

  const linked = await menuFor(row(alpha, "studio-login"));
  for (const label of [
    "New worktree…",
    "Open worktree…",
    "Worktree lifecycle…",
    "Remove worktree",
  ])
    check(linked.includes(label), `the linked worktree's menu lacks ${label}`);

  // A plain workspace: Herdr reports no worktree, creation is still offered.
  const plain = await menuFor(row(alpha, "notes"));
  for (const label of ["New worktree…", "Open worktree…", "Worktree location…"])
    check(plain.includes(label), `the plain workspace's menu lacks ${label}`);
  for (const label of ["Worktree lifecycle…", "Remove worktree"])
    check(!plain.includes(label), `the plain workspace's menu offers ${label}`);

  // The stale host shows its cached worktree button but cannot act on it.
  check(beta?.inert === true, "the stale host's tree is not inert");
  const staleButton = beta?.querySelector<HTMLButtonElement>(
    '[aria-label="Open worktree lifecycle"]',
  );
  check(!!staleButton, "the stale host hides its worktree button");
  staleButton?.focus();
  check(
    !!staleButton && document.activeElement !== staleButton,
    "the stale host's worktree button took focus",
  );

  await fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: phone ? "phone" : "desktop",
      failures,
      linked,
      plain,
    }),
  });
}

void run().catch((error) =>
  fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: phone ? "phone" : "desktop",
      failures: [...failures, `run failed: ${String(error?.stack ?? error)}`],
    }),
  }),
);
