import { Suspense, useEffect, useState } from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import { WORLD_GROUPS_OPEN_EVENT } from "./groupActions";

// The window's content loads when it first opens, not with Town's first
// frame (#1479); the open event is heard from the start.
const GroupsBody = lazyWithReload("world-groups", () =>
  import("./GroupsBody").then((module) => ({ default: module.GroupsBody })),
);

/** Mounted inside the existing WorldPanels provider by WorldControlPlane. */
export function GroupsWindow(props: {
  world: WorldObject;
  onOpenTerminal(id: string): void;
  /** Whether an agent is pinned: member choices list pinned ones first. */
  pinned?: (leaf: WorldLeafObject) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<string | undefined>();
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const onOpen = (event: Event) => {
      setRequested(
        typeof (event as CustomEvent).detail === "string"
          ? (event as CustomEvent<string>).detail
          : undefined,
      );
      setOpen(true);
      setRequest((value) => value + 1);
    };
    window.addEventListener(WORLD_GROUPS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WORLD_GROUPS_OPEN_EVENT, onOpen);
  }, []);
  return open ? (
    <Suspense fallback={null}>
      <GroupsBody
        {...props}
        requested={requested}
        request={request}
        onClose={() => setOpen(false)}
      />
    </Suspense>
  ) : null;
}
