import type {
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";

/**
 * One project the Code view can open: a folder on one connection, as World's
 * rooms and agents report it. A room's folder is its checkout (or its working
 * directory); an agent working in another folder of the same host adds that
 * folder as its own project. Nothing here guesses a folder a runtime did not
 * report.
 */
export type CodeProject = {
  key: string;
  connectionId: string;
  generation: number;
  hostLabel: string;
  folder: string;
  label: string;
  /** Rooms whose folder this is. */
  spaces: WorldSpaceObject[];
  /** Agents and terminals working in this folder or below it. */
  leaves: WorldLeafObject[];
  stale: boolean;
};

export function codeProjectKey(connectionId: string, folder: string) {
  return `${connectionId}\u0000${folder}`;
}

/** An absolute POSIX folder without a trailing slash; anything else is not a project. */
export function projectFolder(value: string | undefined | null) {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}

function leafFolder(leaf: WorldLeafObject) {
  return projectFolder(leaf.pane.foreground_cwd ?? leaf.pane.cwd);
}

function spaceFolder(space: WorldSpaceObject) {
  return projectFolder(
    space.workspace.worktree?.checkout_path ?? space.workspace.cwd,
  );
}

function within(path: string, folder: string) {
  return folder === "/" || path === folder || path.startsWith(`${folder}/`);
}

function basename(folder: string) {
  if (folder === "/") return "/";
  return folder.slice(folder.lastIndexOf("/") + 1);
}

export function codeProjects(world: WorldObject): CodeProject[] {
  const projects = new Map<string, CodeProject>();
  const add = (
    connectionId: string,
    generation: number,
    hostLabel: string,
    folder: string,
    label: string,
    stale: boolean,
  ) => {
    const key = codeProjectKey(connectionId, folder);
    let project = projects.get(key);
    if (!project) {
      project = {
        key,
        connectionId,
        generation,
        hostLabel,
        folder,
        label,
        spaces: [],
        leaves: [],
        stale,
      };
      projects.set(key, project);
    } else if (!stale) project.stale = false;
    return project;
  };
  for (const space of world.spaces) {
    // A room without its own folder takes its first agent's or terminal's.
    const folder =
      spaceFolder(space) ??
      space.children.map(leafFolder).find((value) => value !== null) ??
      null;
    if (!folder) continue;
    const label =
      space.workspace.worktree?.repo_name &&
      space.workspace.worktree.is_linked_worktree
        ? `${space.label} · ${basename(folder)}`
        : space.label || basename(folder);
    add(
      space.connectionId,
      space.generation,
      space.hostLabel,
      folder,
      label,
      space.stale,
    ).spaces.push(space);
  }
  // Agents in a folder no room names (a linked checkout, say) get their own.
  for (const leaf of world.leaves) {
    const folder = leafFolder(leaf);
    if (!folder) continue;
    const covered = [...projects.values()].some(
      (project) =>
        project.connectionId === leaf.connectionId &&
        within(folder, project.folder),
    );
    if (!covered && leaf.kind === "agent")
      add(
        leaf.connectionId,
        leaf.generation,
        leaf.hostLabel,
        folder,
        basename(folder),
        leaf.stale,
      );
  }
  for (const project of projects.values()) {
    const seen = new Set<string>();
    for (const leaf of world.leaves) {
      if (leaf.connectionId !== project.connectionId) continue;
      const folder = leafFolder(leaf);
      const inRoom = project.spaces.some((space) => space.id === leaf.parentId);
      if (!(inRoom || (folder && within(folder, project.folder)))) continue;
      if (seen.has(leaf.id)) continue;
      seen.add(leaf.id);
      project.leaves.push(leaf);
    }
    // Agents first, then terminals; each by name.
    project.leaves.sort(
      (a, b) =>
        Number(a.kind !== "agent") - Number(b.kind !== "agent") ||
        leafName(a).localeCompare(leafName(b)),
    );
  }
  return [...projects.values()].sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) ||
      a.hostLabel.localeCompare(b.hostLabel) ||
      a.label.localeCompare(b.label) ||
      a.folder.localeCompare(b.folder),
  );
}

export function leafName(leaf: WorldLeafObject) {
  return (
    leaf.agentName ||
    leaf.agentLabel ||
    leaf.tabLabel ||
    leaf.label ||
    (leaf.kind === "agent" ? "Agent" : "Terminal")
  );
}

/** A folder with the home part shortened, for display only. */
export function displayFolder(folder: string) {
  return folder.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}
