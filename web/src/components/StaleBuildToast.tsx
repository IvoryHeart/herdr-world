import { useEffect, useState } from "react";
import {
  checkServedBuild,
  dismissReloadRequest,
  type ReloadOffer,
  reloadOffer,
  useBuildFreshness,
} from "../buildFreshness";
import { CloseButton } from "./CloseButton";
import { reloadApplicationPage } from "./ConfigMenu";
import { ToastMark } from "./NoticeContent";
import { Toast } from "./Toast";

/** The reload to offer, or null while this tab is current or it was put off. */
export function useStaleBuild(status: string) {
  const build = useBuildFreshness();
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    // A server restart drops the socket; ask which build it serves once back.
    if (status === "connected") void checkServedBuild();
  }, [status]);
  const offer = reloadOffer(build, dismissed);
  if (!offer) return null;
  return {
    offer,
    onDismiss: () => {
      if (offer.kind === "chunk") dismissReloadRequest();
      setDismissed(build.served);
    },
  };
}

/** Offers, never takes, a reload when this tab's build is out of date. */
export function StaleBuildToast({
  offer,
  onDismiss,
}: {
  offer: ReloadOffer;
  onDismiss: () => void;
}) {
  return (
    <Toast
      className="toast toast-info"
      role="status"
      onDismiss={onDismiss}
      notificationKey={offer.kind === "build" ? offer.served : "chunk"}
    >
      <ToastMark kind="info" />
      <div className="toast-content">
        {offer.kind === "build" ? (
          <>
            <strong>
              The service now serves a different Herdr World build
            </strong>
            <p>
              This tab runs {offer.loaded}; the service serves {offer.served}.
              Herdr sessions keep running.
            </p>
          </>
        ) : (
          <>
            <strong>Reload to finish loading Herdr World</strong>
            <p>
              Part of the app could not load, usually after a service upgrade.
              Herdr sessions keep running.
            </p>
          </>
        )}
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
        label="Dismiss reload notification"
        onClick={onDismiss}
      />
    </Toast>
  );
}
