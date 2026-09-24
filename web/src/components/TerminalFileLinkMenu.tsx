import { useEffect, useState } from "react";
import type { ConnectionClient } from "../api";
import {
  directoryPreviewPath,
  normalizeFilesystemPath,
} from "../filesystemPaths";
import { useStoreSelector } from "../store";
import { ActionsMenu } from "./ActionsMenu";
import { requestFilePreview } from "./fileExplorerResources";
import "./ContextMenu.css";

export type TerminalFileLinkMenuState = {
  x: number;
  y: number;
  path: string;
  workspaceId: string;
};

export function TerminalFileLinkMenu({
  state,
  client,
  onPreview,
  onWorkspace,
  onClose,
}: {
  state: TerminalFileLinkMenuState;
  client: ConnectionClient;
  onPreview: (path: string) => void;
  onWorkspace: (path: string) => void;
  onClose: () => void;
}) {
  const workspaces = useStoreSelector((state) => state.workspaces);
  const [directory, setDirectory] = useState<string | null>(null);
  const alreadyOpen =
    directory !== null &&
    workspaces.some((workspace) => {
      const root = workspace.worktree?.checkout_path ?? workspace.cwd;
      return root && normalizeFilesystemPath(root) === directory;
    });
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let current = true;
    setDirectory(null);
    setChecking(true);
    void requestFilePreview(state.workspaceId, state.path, { client })
      .then(
        (preview) => {
          if (current && client.isCurrent())
            setDirectory(directoryPreviewPath(preview));
        },
        () => {
          /* Preview retains the existing error UI for unavailable paths. */
        },
      )
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [client, state]);
  return (
    <ActionsMenu
      x={state.x}
      y={state.y}
      header={{ title: state.path }}
      onClose={onClose}
      groups={[
        {
          label: "File actions",
          items: [
            {
              key: "preview",
              label: directory ? "Preview directory" : "Preview file",
              action: () => onPreview(state.path),
            },
            ...(directory && !alreadyOpen
              ? [
                  {
                    key: "workspace",
                    label: "Open directory as workspace...",
                    action: () => onWorkspace(directory),
                  },
                ]
              : []),
            ...(checking
              ? [
                  {
                    key: "checking",
                    label: "Checking directory...",
                    disabled: true,
                    action: () => {},
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
}
