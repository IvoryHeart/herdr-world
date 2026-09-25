// File explorer rows drag their absolute path. The custom type lets terminal
// panes recognize the drag; text/plain lets ordinary text fields insert it.
export const WORKSPACE_PATH_DRAG_TYPE = "application/x-herdr-world-path";

type PathDragData = Pick<
  DataTransfer,
  "effectAllowed" | "getData" | "setData" | "types"
>;

export function setWorkspacePathDragData(data: PathDragData, path: string) {
  data.effectAllowed = "copy";
  data.setData(WORKSPACE_PATH_DRAG_TYPE, path);
  data.setData("text/plain", path);
}

// Browsers hide drag data until drop, so dragover can only check the type.
export function isWorkspacePathDrag(data: Pick<DataTransfer, "types">) {
  return Array.from(data.types).includes(WORKSPACE_PATH_DRAG_TYPE);
}

export function workspacePathFromDrag(data: Pick<DataTransfer, "getData">) {
  return data.getData(WORKSPACE_PATH_DRAG_TYPE);
}
