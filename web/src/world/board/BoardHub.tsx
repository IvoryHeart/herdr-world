/**
 * Board's hub beside the bin: the town center's actions (useTownCenter.ts)
 * as compact buttons. **+** launches an agent, the crown opens the Town
 * master's chat and ⋯ lists every action in a plain menu. Escape, a press
 * outside or Back on a phone closes the menu.
 */

import { DoorOpen, MoreHorizontal, Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { worldLocalStorage } from "../../browserStorage";
import { useLayer } from "../../layerStack";
import { store } from "../../store";
import { requestAgentLaunch, useAgentProfiles } from "../agentProfiles";
import { readOfficePreferences } from "../officePreferences";
import type { TownCenterAction } from "../town/TownCenterMenu";
import {
  launchAction,
  needsYouAction,
  profilesAction,
  townMasterAction,
} from "../town/useTownCenter";
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
 * The hub's actions, in the town center's order: New agent, Town master,
 * Needs you, Profiles and New workspace (Board's word for a room). Town's
 * Summary stays in Town; Board's Work lens is its counterpart.
 */
export function boardHubActions({
  world,
  selectedId,
  holder,
  name,
  openChat,
  onNewWorkspace,
  toast,
}: {
  world: Pick<WorldObject, "nodeById" | "leaves" | "hosts">;
  selectedId: string | null;
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  /** Menu → Town master, trimmed. */
  name: string;
  openChat(nodeId: string): void;
  onNewWorkspace(): void;
  toast(kind: "ok" | "error", text: string): void;
}): TownCenterAction[] {
  const space = boardLaunchSpace(world, selectedId);
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
  const hostReady = world.hosts.some((host) => host.actionable && !host.stale);
  return [
    launchAction(
      space
        ? {
            label: space.label,
            run: () =>
              requestAgentLaunch({
                connectionId: space.connectionId,
                generation: space.generation,
                workspaceId: space.nativeId,
                workspaceLabel: space.label,
              }),
          }
        : null,
    ),
    townMasterAction({ world, roster, holder, name, openChat, toast }),
    needsYouAction(),
    profilesAction(),
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
  onNewWorkspace,
}: {
  world: WorldObject;
  selectedId: string | null;
  /** Open an agent's Chat, by its node ID. */
  openChat(nodeId: string): void;
  onNewWorkspace(): void;
}) {
  const holder = useAgentProfiles().document?.town_master ?? null;
  const actions = boardHubActions({
    world,
    selectedId,
    holder,
    name: readOfficePreferences(worldLocalStorage).townMaster.trim(),
    openChat,
    onNewWorkspace,
    toast: (kind, text) =>
      store.notify({
        kind: kind === "ok" ? "success" : "error",
        message: text,
      }),
  });
  return <BoardHubDock actions={actions} />;
}

/**
 * The hub's look: **+** (the primary action), the Town master's crown and ⋯
 * for the menu of every action.
 */
export function BoardHubDock({
  actions,
}: {
  actions: readonly TownCenterAction[];
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
    <div className="board-hub" role="group" aria-label="Town center">
      {button(Launch, <Plus size={18} aria-hidden="true" />)}
      {button(Master, <Master.icon size={16} aria-hidden="true" />)}
      <button
        ref={more}
        type="button"
        className="board-hub-button"
        data-action="more"
        aria-label="Town center actions"
        title="Town center actions"
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
          aria-label="Town center"
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
