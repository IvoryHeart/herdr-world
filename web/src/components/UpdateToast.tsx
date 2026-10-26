import type { UpdateInfo } from "../store/types";
import { CloseButton } from "./CloseButton";
import { ToastMark } from "./NoticeContent";
import { Toast } from "./Toast";

export function UpdateToast({
  info,
  dismissedVersion,
  installing,
  onDismiss,
  onInstall,
}: {
  info: UpdateInfo | null;
  dismissedVersion: string | null;
  installing: boolean;
  onDismiss: () => void;
  onInstall: () => void;
}) {
  if (!info?.update_available || dismissedVersion === info.latest_version)
    return null;
  return (
    <Toast
      className={`toast toast-info ${installing ? "toast-loading" : ""}`}
      role="status"
      onDismiss={onDismiss}
      notificationKey={info.latest_version}
      dismissDisabled={installing}
    >
      <ToastMark kind="info" loading={installing} />
      <div className="toast-content">
        <strong>Herdr World {info.latest_version} is available</strong>
        <p>
          Current {info.current_version}
          {info.can_auto_update
            ? " · ready to update and restart"
            : info.reason
              ? ` · ${info.reason}`
              : ""}
        </p>
        <div className="toast-actions">
          {info.can_auto_update ? (
            <button
              type="button"
              className="toast-action primary"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? "Updating..." : "Upgrade & restart"}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-action"
            onClick={onDismiss}
            disabled={installing}
          >
            Dismiss
          </button>
        </div>
      </div>
      <CloseButton
        variant="toast"
        label="Dismiss update notification"
        onClick={onDismiss}
        disabled={installing}
      />
    </Toast>
  );
}
