import { type ComponentProps, Suspense, useState } from "react";
import { lazyWithReload } from "../lazyWithReload";
import type { WorktreeLifecycleDialog } from "./WorktreeLifecycleDialog";

const Dialog = lazyWithReload("worktree-lifecycle", () =>
  import("./WorktreeLifecycleDialog").then((module) => ({
    default: module.WorktreeLifecycleDialog,
  })),
);

/**
 * The worktree dialog, loaded when it first opens rather than with Town's
 * first frame (#1479). A closed dialog does no work, so it stays mounted
 * once loaded.
 */
export function LazyWorktreeLifecycleDialog(
  props: ComponentProps<typeof WorktreeLifecycleDialog>,
) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  return opened ? (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  ) : null;
}
