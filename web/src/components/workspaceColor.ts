import { createContext } from "react";

/**
 * Optional workspace colours, supplied by the host application (World keeps
 * them with terminal colours). The tree shows a chosen colour beside the
 * workspace's name and its menu offers the palette; where it is stored is the
 * host's concern, as with TabBar's TabColorControl.
 */
export type WorkspaceColorControl = {
  palette: readonly { id: string; hex: string }[];
  /** The chosen colour, or `custom: false` for none. */
  colorOf(workspaceId: string): { id: string; custom: boolean };
  onColor(workspaceId: string, id: string | null): void;
};

export const WorkspaceColorContext =
  createContext<WorkspaceColorControl | null>(null);
