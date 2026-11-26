import { libraryAvailable } from "../memory/memoryTargets";
import { useMemoryStore } from "../memory/memoryClient";
/**
 * Board's hub beside the bin: the town center's actions (useTownCenter.ts)
 * as compact buttons. **+** launches an agent, the crown opens the Town
 * master's chat and ⋯ lists every action in a plain menu. Escape, a press
 * outside or Back on a phone closes the menu.
 *
 * Names follow the view: Town's metaphors stay in Town, so the hub says
 * Past sessions for Apartments and Memory for the Library (BOARD_HUB_NAMES).
 */

import { DoorOpen, MoreHorizontal, Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useLayoutPreferences } from "../../layoutPreferences";
import { useTownMaster } from "../town/useTownMaster";
import { useLayer } from "../../layerStack";
import { store } from "../../store";
import { requestAgentLaunch, useAgentProfiles } from "../agentProfiles";
import { useApartments } from "../apartments/useApartments";
import { agentName } from "../deskAgentLabels";
import type { TownCenterAction } from "../town/TownCenterMenu";
import {
  apartmentsAction,
  launchAction,
  libraryAction,
  needsYouAction,
  profilesAction,
  summaryAction,
  townMasterAction,
} from "../town/useTownCenter";
import { useGreetingAnchor } from "../townMasterGreeting";
import type { WorldObject, WorldSpaceObject } from "../worldObject";
import "./boardHub.css";

/**
 * The workspace a new agent starts in: the selected card's, or the selected
 * workspace, when it can launch now. Otherwise the launcher asks.
 */
export function boardLaunchSpace(
  world: Pick<WorldObject, "nodeById">,
  selectedId: string | null,
): WorldSpaceObject | null {
  const node = selectedId ? world.nodeById.get(selectedId) : undefined;
  const space =
    node?.kind === "space"
      ? node
      : node?.kind === "agent" || node?.kind === "terminal"
        ? world.nodeById.get(node.parentId)
        : undefined;
  return space?.kind === "space" &&
    space.actionable &&
    !space.stale &&
    space.capabilities.launcher
    ? space
    : null;
}

/**
 * Board's plain names for town center actions that Town names after its
 * buildings. The surfaces they open keep their own titles.
 */
const BOARD_HUB_NAMES: Readonly<Record<string, string>> = {
  apartments: "Past sessions",
  library: "Memory",
};

/** `action` under its Board name, when Board names it differently. */
const boardNamed = (action: TownCenterAction): TownCenterAction => ({
  ...action,
  label: BOARD_HUB_NAMES[action.id] ?? action.label,
});

/** Past sessions: finished agents (Town's Apartments), with their count. */
const boardPastSessionsAction = (residents?: number) => ({
  ...boardNamed(apartmentsAction()),
  detail: residents
    ? `${residents} finished agent${residents === 1 ? "" : "s"}`
    : undefined,
});

/**
 * Memory on the selected card (Town's Library): an agent's memory, a
 * workspace's, else everything on the first host.
 */
export function boardLibraryAction(
  world: Pick<WorldObject, "nodeById" | "leaves">,
  selectedId: string | null,
) {
  const node = selectedId ? world.nodeById.get(selectedId) : undefined;
  if (node && !node.stale && (node.kind === "agent" || node.kind === "space")) {
    const request =
      node.kind === "agent"
        ? { connectionId: node.connectionId, agentId: node.nativeId }
        : { connectionId: node.connectionId, workspaceId: node.nativeId };
    return libraryAvailable(world, request)
      ? boardNamed(
          libraryAction(
            request,
            `for ${node.kind === "agent" ? agentName(node) : node.label}`,
          ),
        )
      : null;
  }
  return libraryAvailable(world) ? boardNamed(libraryAction()) : null;
}

/**
 * The hub's actions, in the town center's order: New agent, Town master,
 * Needs you, Summary, Profiles, Past sessions, Memory and New workspace
 * (Board's word for a room).
 * Summary is Town's one summary: Board takes you to Town with it open.
 */
export function boardHubActions({
  world,
  selectedId,
  holder,
  openChat,
  onOpenSummary,
  onNewWorkspace,
  toast,
  residents,
}: {
  world: Pick<WorldObject, "nodeById" | "leaves" | "hosts">;
  selectedId: string | null;
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  openChat(nodeId: string, focus?: boolean): void;
  /** Go to Town with its summary open. */
  onOpenSummary(): void;
  onNewWorkspace(): void;
  toast(kind: "ok" | "error", text: string): void;
  /** Past sessions' count: Apartments' residents (the same store as Town's). */
  residents?: number;
}): TownCenterAction[] {
  const space = boardLaunchSpace(world, selectedId);
  const library = boardLibraryAction(world, selectedId);
  const roster = world.leaves.flatMap((leaf) =>
    leaf.kind === "agent"
      ? [
          {
            agent: {
              // Town's agent key is its leaf's ID, so both views agree.
              key: leaf.id,
              agentName: leaf.agentName,
              displayLabel: leaf.agentName ?? leaf.agentLabel ?? leaf.label,
              stale: leaf.stale,
              canOpenInSpaces: leaf.capabilities.openSpaces,
            },
          },
        ]
      : [],
  );
  // A herdr-core host takes a room too (New workspace offers it as a host).
  const hostReady = world.hosts.some(
    (host) => (host.actionable || host.coreControl) && !host.stale,
  );
  return [
    launchAction(
      space
        ? {
            label: space.label,
            // The town center's action: the agent arrives there in Town.
            run: () =>
              requestAgentLaunch(
                {
                  connectionId: space.connectionId,
                  generation: space.generation,
                  workspaceId: space.nativeId,
                  workspaceLabel: space.label,
                },
                "center",
              ),
          }
        : null,
    ),
    townMasterAction({ world, roster, holder, openChat, toast }),
    needsYouAction(),
    summaryAction(onOpenSummary, "in Town"),
    profilesAction(),
    boardPastSessionsAction(residents),
    ...(library ? [library] : []),
    {
      id: "workspace",
      label: "New workspace",
      icon: DoorOpen,
      disabled: !hostReady,
      detail: hostReady ? undefined : "No host is ready",
      run: onNewWorkspace,
    },
  ];
}

const label = (action: TownCenterAction) =>
  [action.label, action.count ? `${action.count} waiting` : null, action.detail]
    .filter(Boolean)
    .join(", ");

export function BoardHub({
  world,
  selectedId,
  openChat,
  onOpenSummary,
  onNewWorkspace,
}: {
  world: WorldObject;
  selectedId: string | null;
  /** Open an agent's Chat, by its node ID. */
  openChat(nodeId: string, focus?: boolean): void;
  /** Go to Town with its summary open. */
  onOpenSummary(): void;
  onNewWorkspace(): void;
}) {
  const holder = useAgentProfiles().document?.town_master ?? null;
  const { mobile } = useLayoutPreferences();
  useTownMaster(world, holder, mobile, (key) => openChat(key, false));
  // The Town Master's greeting opens at the hub on wide screens.
  const greetingAnchor = useGreetingAnchor();
  const residents = useApartments().residents.length;
  // Memory appears as a host's Library becomes available (#1342).
  useMemoryStore();
  const actions = boardHubActions({
    residents,
    world,
    selectedId,
    holder,
    openChat,
    onOpenSummary,
    onNewWorkspace,
    toast: (kind, text) =>
      store.notify({
        kind: kind === "ok" ? "success" : "error",
        message: text,
      }),
  });
  return <BoardHubDock actions={actions} anchorRef={greetingAnchor} />;
}

/**
 * The hub's look: **+** (the primary action), the Town master's crown and ⋯
 * for the menu of every action.
 */
export function BoardHubDock({
  actions,
  anchorRef,
}: {
  actions: readonly TownCenterAction[];
  anchorRef?: (element: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useLayer(open, () => setOpen(false), {
    element: () => menu.current,
    anchors: () => [more.current],
  });
  // The first usable action takes focus as the menu opens.
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLButtonElement>(
          "[role='menuitem']:not([aria-disabled='true'])",
        )
        ?.focus({ preventScroll: true });
  }, [open]);
  const run = (action: TownCenterAction) => {
    if (action.disabled) return;
    setOpen(false);
    action.run();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ) ?? []),
    ];
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null || !items.length) return;
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  const quick = (id: string) => actions.find((action) => action.id === id)!;
  const button = (action: TownCenterAction, glyph: ReactNode) => (
    <button
      type="button"
      className="board-hub-button"
      data-action={action.id}
      data-primary={action.primary || undefined}
      aria-label={label(action)}
      title={label(action)}
      onClick={() => run(action)}
    >
      {glyph}
    </button>
  );
  const Launch = quick("launch");
  const Master = quick("master");
  return (
    <div ref={anchorRef} className="board-hub" role="group" aria-label="Hub">
      {button(Launch, <Plus size={18} aria-hidden="true" />)}
      {button(Master, <Master.icon size={16} aria-hidden="true" />)}
      <button
        ref={more}
        type="button"
        className="board-hub-button"
        data-action="more"
        aria-label="Hub actions"
        title="Hub actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          className="board-hub-menu"
          role="menu"
          aria-label="Hub"
          onKeyDown={keyDown}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              data-action={action.id}
              aria-disabled={action.disabled || undefined}
              aria-label={label(action)}
              onClick={() => run(action)}
            >
              <action.icon size={16} aria-hidden="true" />
              <span aria-hidden="true">{action.label}</span>
              {action.detail ? (
                <small aria-hidden="true">{action.detail}</small>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
