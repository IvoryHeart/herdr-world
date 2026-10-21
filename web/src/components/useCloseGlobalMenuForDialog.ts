import { useEffect } from "react";

export function observeDialogsForGlobalMenu(
  root: HTMLElement,
  onDialog: () => void,
) {
  const closeForDialog = () => {
    if (root.querySelector(".modal-backdrop:not([hidden])")) onDialog();
  };
  closeForDialog();
  const observer = new root.ownerDocument.defaultView!.MutationObserver(
    closeForDialog,
  );
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  return () => observer.disconnect();
}

// Global body-portal menus must yield even to dialogs rendered inside the
// transformed mobile app. Comparing their numeric z-indices is insufficient.
// Do not apply this to popovers owned by a dialog (e.g. its select fields).
export function useCloseGlobalMenuForDialog(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    return observeDialogsForGlobalMenu(document.body, () => setOpen(false));
  }, [open, setOpen]);
}
