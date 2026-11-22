/**
 * Opening the Library (#1027) from anywhere: Town's library and center ring,
 * Board's hub and an agent's settings in the Inspector. The dialog itself is
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
};

export function openMemoryLibrary(request: MemoryLibraryRequest = {}) {
  window.dispatchEvent(
    new CustomEvent<MemoryLibraryRequest>(WORLD_MEMORY_EVENT, {
      detail: request,
    }),
  );
}
