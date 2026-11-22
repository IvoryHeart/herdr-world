import type { ApartmentResident } from "../../../../../shared/apartments";
import {
  type BoardElement,
  type BoardLibraryMemorySource,
  type BoardLogSource,
  isLibraryMemory,
} from "../../../../../shared/boardElements";
import type { MemoryCatalog } from "../../../../../shared/memory";
import type { MemoryHostTarget } from "../../memory/memoryClient";
import type { MemoryLibraryRequest } from "../../memory/memoryEvents";
import type { WorldObject } from "../../worldObject";
import type { SourcePlace } from "./boardElementRead";

/**
 * How Board's Memory and Agent log elements reach World's memory Library
 * (openspec/specs/world-memory) and Apartments
 * (openspec/specs/world-surfaces/apartments). Board keeps references only:
 * the Library reads a memory, Apartments keeps a finished agent.
 */

/** One memory the Add form offers from a host's Library catalog. */
export type LibraryMemoryChoice = {
  /** JSON of [memory_source_id, path, workspace_id or ""]. */
  value: string;
  sourceId: string;
  path: string;
  /** The project it is listed under; Open in Memory opens there. */
  workspaceId: string | null;
  /** Its shelf: a project's label, or "Every project" for user files. */
  group: string;
  label: string;
};

const KIND_WORDS = {
  instructions: "instructions",
  rules: "rules",
  memory: "memory",
} as const;

/**
 * A host's readable memories, grouped as the Library shelves them: under the
 * project they belong to (the one passed first), else under every project
 * for user-wide files. Refused and missing entries are left out, since there
 * is nothing to read yet.
 */
export function libraryMemoryChoices(
  catalog: Pick<MemoryCatalog, "projects" | "agents" | "sources" | "entries">,
  firstProject?: string | null,
): LibraryMemoryChoice[] {
  const projects = new Map(catalog.projects.map((p) => [p.id, p.label]));
  const agentProject = new Map(catalog.agents.map((a) => [a.id, a.project_id]));
  const choices: LibraryMemoryChoice[] = [];
  for (const entry of catalog.entries) {
    if (entry.state !== "available") continue;
    const source = catalog.sources.find((s) => s.id === entry.source_id);
    if (!source || source.state !== "available") continue;
    const owners = [
      ...source.project_ids,
      ...source.agent_ids.flatMap((id) => agentProject.get(id) ?? []),
    ];
    const workspaceId =
      source.scope === "user"
        ? null
        : ((firstProject && owners.includes(firstProject)
            ? firstProject
            : owners[0]) ?? null);
    choices.push({
      value: JSON.stringify([source.id, entry.path, workspaceId ?? ""]),
      sourceId: source.id,
      path: entry.path,
      workspaceId,
      group:
        workspaceId === null
          ? "Every project"
          : (projects.get(workspaceId) ?? workspaceId),
      // Two harnesses can each keep an AGENTS.md: the harness tells them apart.
      label: [
        entry.path,
        `${source.scope} ${KIND_WORDS[source.kind]}`,
        source.harnesses.join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  const rank = (choice: LibraryMemoryChoice) =>
    choice.workspaceId === null
      ? 2
      : choice.workspaceId === firstProject
        ? 0
        : 1;
  return choices.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.group.localeCompare(b.group) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Where Open in Memory goes for a memory element: its host and project.
 * A project-file memory opens its project's readers when the Library has
 * them (the caller checks the Library is available there).
 */
export function libraryRequestFor(
  element: BoardElement,
): MemoryLibraryRequest | null {
  if (element.kind !== "memory") return null;
  const source = element.source;
  return {
    connectionId: source.connection_id,
    ...(source.workspace_id ? { workspaceId: source.workspace_id } : {}),
  };
}

/** Whether a memory element names a Library memory. */
export const fromLibrary = (element: BoardElement) =>
  element.kind === "memory" && isLibraryMemory(element.source);

/**
 * The Apartments resident a log belongs to, on the log's own host only: the
 * resident saved with it, else one whose harness session or ID is the log's
 * agent reference (so a log saved from the CLI with a session ID links too).
 * Null when none lives there now (never one from another host).
 */
export function residentForLog(
  source: Pick<BoardLogSource, "connection_id" | "agent_ref" | "apartment_id">,
  residents: readonly ApartmentResident[],
): ApartmentResident | null {
  const here = residents.filter(
    (resident) => resident.connection_id === source.connection_id,
  );
  if (source.apartment_id)
    return here.find((r) => r.id === source.apartment_id) ?? null;
  const ref = source.agent_ref?.trim();
  if (!ref) return null;
  return here.find((r) => r.session_id === ref || r.id === ref) ?? null;
}

/** How many finished agents the Agent log form lists. */
export const RESIDENT_CHOICES = 50;

/**
 * Finished agents the Agent log form offers: the newest on the chosen host,
 * plus the one already saved with the log.
 */
export function residentChoices(
  residents: readonly ApartmentResident[],
  connectionId: string | null,
  savedId?: string,
): ApartmentResident[] {
  const here = residents
    .filter((resident) => resident.connection_id === connectionId)
    .sort((a, b) => b.moved_out_at - a.moved_out_at);
  const shown = here.slice(0, RESIDENT_CHOICES);
  const saved = savedId ? here.find((r) => r.id === savedId) : undefined;
  return saved && !shown.includes(saved) ? [...shown, saved] : shown;
}

/** A resident in one line: its name, harness and project folder. */
export function residentLabel(resident: ApartmentResident) {
  const folder = resident.cwd?.split("/").filter(Boolean).pop();
  return [
    resident.name,
    resident.harness && resident.harness !== resident.name
      ? resident.harness
      : null,
    folder,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Where a Library memory reads from: the host as the Library knows it now
 * (its live connection and generation), never another host. While the host
 * is not one the Library can read, the generation is null and the element
 * is offline.
 */
export function libraryPlace(
  world: Pick<WorldObject, "hosts">,
  libraryHosts: readonly Pick<
    MemoryHostTarget,
    "connection_id" | "connection_generation" | "label"
  >[],
  source: Pick<BoardLibraryMemorySource, "connection_id" | "workspace_id">,
): SourcePlace {
  const live = libraryHosts.find(
    (host) => host.connection_id === source.connection_id,
  );
  const host = world.hosts.find(
    (entry) => entry.connectionId === source.connection_id,
  );
  const space = source.workspace_id
    ? host?.spaces.find((entry) => entry.nativeId === source.workspace_id)
    : undefined;
  return {
    hostLabel: live?.label ?? host?.label ?? source.connection_id,
    workspaceLabel: space?.label ? `Memory · ${space.label}` : "Memory",
    generation: live?.connection_generation ?? null,
  };
}
