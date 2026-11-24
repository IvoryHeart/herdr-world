/**
 * Opening the Library (#1027) from anywhere: Town's library and center ring,
 * Board's hub, an agent's settings in the Inspector and, on its "Made by
 * agents" wing (#1327), the "Made" summaries on Desk, Town and Chat. The dialog itself is
 * lazy (its feature host, web/src/features/memory/mount.tsx, mounts it on
 * this event), so callers import only this small module.
 */

export const WORLD_MEMORY_EVENT = "herdr-world:memory";

/** What to open on: a host, and optionally one project or agent on it. */
export type MemoryLibraryRequest = {
  connectionId?: string;
  /** A World workspace (room) ID on that host. */
  workspaceId?: string;
  /** An agent's pane ID on that host: shows what it will load. */
  agentId?: string;
  /** The wing to open on: memory (the default) or what agents made. */
  wing?: "memory" | "artefacts";
  /** One made thing to open in the reader (its artefact ID). */
  artefactId?: string;
};

export function openMemoryLibrary(request: MemoryLibraryRequest = {}) {
  window.dispatchEvent(
    new CustomEvent<MemoryLibraryRequest>(WORLD_MEMORY_EVENT, {
      detail: request,
    }),
  );
}
