import { useEffect, useState } from "react";
import {
  checkServedBuild,
  isStaleBuild,
  useBuildFreshness,
} from "../buildFreshness";
import { CloseButton } from "./CloseButton";
import { reloadApplicationPage } from "./ConfigMenu";
import { ToastMark } from "./NoticeContent";
import { Toast } from "./Toast";

/** The undismissed newer served build, or null while this tab is current. */
export function useStaleBuild(status: string) {
  const build = useBuildFreshness();
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    // A server restart drops the socket; ask which build it serves once back.
    if (status === "connected") void checkServedBuild();
  }, [status]);
  if (!isStaleBuild(build) || build.served === dismissed) return null;
  const served = build.served!;
  return {
    loaded: build.loaded!,
    served,
    onDismiss: () => setDismissed(served),
  };
}

/** Offers a reload when the server serves a newer build than this tab runs. */
export function StaleBuildToast({
  loaded,
  served,
  onDismiss,
}: {
  loaded: string;
  served: string;
  onDismiss: () => void;
}) {
  return (
    <Toast
      className="toast toast-info"
      role="status"
      onDismiss={onDismiss}
      notificationKey={served}
    >
      <ToastMark kind="info" />
      <div className="toast-content">
        <strong>A newer Herdr World build is available</strong>
        <p>
          This tab runs {loaded}; the server now serves {served}. Reload when
          convenient. Herdr sessions keep running.
        </p>
        <div className="toast-actions">
          <button
            type="button"
            className="toast-action primary"
            onClick={() => reloadApplicationPage()}
          >
            Reload
          </button>
          <button type="button" className="toast-action" onClick={onDismiss}>
            Later
          </button>
        </div>
      </div>
      <CloseButton
        variant="toast"
        label="Dismiss newer build notification"
        onClick={onDismiss}
      />
    </Toast>
  );
}
